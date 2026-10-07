const readline = require('node:readline');
const fs = require('node:fs');
const nodePath = require('node:path');
const env = process.env;
const version = env.FAKE_BRIDGE_VERSION ? Number(env.FAKE_BRIDGE_VERSION) : __VERSION__;
const contract = env.FAKE_BRIDGE_CONTRACT || '__CONTRACT__';
const heartbeatMs =
	env.FAKE_BRIDGE_HEARTBEAT_MS === undefined ? 50 : Number(env.FAKE_BRIDGE_HEARTBEAT_MS);
const ackDelay = Number(env.FAKE_BRIDGE_ACK_DELAY_MS || 0);
const reverse = Number(env.FAKE_BRIDGE_REVERSE_ACKS || 0);
const approvalPath = env.FAKE_BRIDGE_APPROVAL_PATH || '/tmp/outside.txt';
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
const claudeState = env.FAKE_BRIDGE_CLAUDE_STATE || 'ready';
const makeCapability = (capabilityVersion, message) => ({
	state: claudeState,
	installed: claudeState !== 'missing',
	authenticated: claudeState === 'ready' ? true : claudeState === 'needs_auth' ? false : null,
	version: claudeState === 'missing' ? null : capabilityVersion,
	account: claudeState === 'ready' ? { email: 'e2e@example.com', plan: 'Claude Max' } : null,
	models: [
		{
			id: 'default',
			label: 'Default',
			description: 'Fixture default',
			efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
		},
		{
			id: 'sonnet',
			label: 'Sonnet',
			description: 'Fixture sonnet',
			efforts: ['low', 'medium', 'high', 'max'],
		},
	],
	defaultModel: 'default',
	message,
});
if (env.FAKE_BRIDGE_STDERR_EXIT) {
	process.stderr.write(env.FAKE_BRIDGE_STDERR_EXIT + '\n');
	process.exit(1);
}
write({
	type: 'bridge.ready',
	contractName: contract,
	protocolVersion: version,
	pid: process.pid,
	capabilities: [makeCapability('fixture-1.0.0', 'Ready')],
	heartbeatIntervalMs: __HEARTBEAT_INTERVAL__,
});
let heartbeat = null;
if (heartbeatMs > 0) {
	heartbeat = setInterval(
		() => write({ type: 'bridge.heartbeat', protocolVersion: version, ts: Date.now() }),
		heartbeatMs,
	);
}
const ack = (id, error) => {
	const frame = {
		type: 'bridge.command_ack',
		protocolVersion: version,
		id,
		accepted: error === undefined,
	};
	if (error !== undefined) frame.error = error;
	if (ackDelay > 0) setTimeout(() => write(frame), ackDelay);
	else write(frame);
};
const conflictedFiles = (prompt) => {
	const lines = prompt.split('\n');
	const start = lines.indexOf('Conflicted files:');
	if (start === -1) return [];
	const listed = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.startsWith('- ')) break;
		listed.push(line.slice(2).replace(/ \(no conflict markers[^)]*\)$/, ''));
	}
	return listed;
};
const pendingRuns = new Map();
const worktrees = new Map();
const event = (frame) => write(frame);
const completeRun = (sessionId, runId, summary, mentions = []) => {
	const mentioned = mentions.map((path) => '`' + path + '`').join(' and ');
	event({ type: 'assistant.delta', runId, contentId: 'c1', text: 'partial ' });
	event({
		type: 'assistant.message',
		runId,
		contentId: 'c1',
		text: mentioned
			? 'Hello from the fake bridge. See ' + mentioned + '.'
			: 'Hello from the fake bridge',
	});
	event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5, interim: true });
	event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5 });
	event({ type: 'run.completed', runId, summary });
	event({ type: 'session.state', sessionId, status: 'completed' });
};
const STREAM_LINE_MS = 100;
const streamRun = (sessionId, runId, lines) => {
	pendingRuns.set(runId, sessionId);
	const toolCallId = 'bash-' + runId;
	event({
		type: 'tool.started',
		runId,
		name: 'Bash',
		toolCallId,
		input: { command: 'ls -la', description: 'List files' },
	});
	event({
		type: 'tool.completed',
		runId,
		name: 'Bash',
		toolCallId,
		output: Array.from({ length: 40 }, (_, index) => 'file-' + (index + 1) + '.txt').join('\n'),
	});
	let text = '';
	let streamed = 0;
	const timer = setInterval(() => {
		if (!pendingRuns.has(runId)) return clearInterval(timer);
		streamed += 1;
		const chunk = 'Streamed line ' + streamed + ' of ' + lines + '.\n\n';
		text += chunk;
		event({ type: 'assistant.delta', runId, contentId: 'stream', text: chunk });
		if (streamed < lines) return;
		clearInterval(timer);
		pendingRuns.delete(runId);
		event({ type: 'assistant.message', runId, contentId: 'stream', text: text.trimEnd() });
		event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5 });
		event({ type: 'run.completed', runId, summary: 'done' });
		event({ type: 'session.state', sessionId, status: 'completed' });
	}, STREAM_LINE_MS);
};
const handle = (command) => {
	switch (command.cmd) {
		case 'start_session':
			if (env.FAKE_BRIDGE_REJECT_START) return ack(command.id, env.FAKE_BRIDGE_REJECT_START);
			if (command.worktreePath) worktrees.set(command.sessionId, command.worktreePath);
			event({
				type: 'session.state',
				sessionId: command.sessionId,
				status: 'idle',
				providerSessionId: 'prov-' + command.sessionId,
			});
			return ack(command.id);
		case 'send_prompt': {
			if (env.FAKE_BRIDGE_REJECT_PROMPT) return ack(command.id, env.FAKE_BRIDGE_REJECT_PROMPT);
			ack(command.id);
			const { sessionId, runId, prompt } = command;
			if (prompt.includes('CRASH')) process.exit(3);
			event({ type: 'run.started', runId, sessionId });
			const worktree = worktrees.get(sessionId);
			for (const edit of prompt.matchAll(/EDIT:([^\s]+)/g)) {
				if (!worktree) break;
				fs.mkdirSync(worktree, { recursive: true });
				fs.writeFileSync(nodePath.join(worktree, edit[1]), 'agent edit ' + runId + '\n');
				event({ type: 'file.changed', runId, path: edit[1] });
			}
			if (worktree && prompt.includes('Resolve the merge conflicts in this workstream')) {
				for (const path of conflictedFiles(prompt)) {
					const file = nodePath.join(worktree, path);
					const kept = fs
						.readFileSync(file, 'utf8')
						.split('\n')
						.filter((line) => !/^(?:<{7}|={7}|>{7})(?: |$)/.test(line));
					fs.writeFileSync(file, kept.join('\n'));
					event({ type: 'file.changed', runId, path });
				}
			}
			const bulk = /BULK:(\d+)/.exec(prompt);
			if (bulk && worktree) {
				for (let index = 0; index < Number(bulk[1]); index += 1) {
					const directory = nodePath.join(worktree, 'bulk', String(Math.floor(index / 500)));
					if (index % 500 === 0) fs.mkdirSync(directory, { recursive: true });
					fs.writeFileSync(nodePath.join(directory, 'file-' + index + '.txt'), 'a\nb\nc\n');
				}
			}
			if (prompt.includes('HANG')) {
				pendingRuns.set(runId, sessionId);
				return;
			}
			if (prompt.includes('APPROVAL')) {
				pendingRuns.set(runId, sessionId);
				event({
					type: 'approval.requested',
					sessionId,
					runId,
					approvalId: 'approval-1',
					reason: 'read outside',
					toolName: 'read_file',
					permission: {
						capability: 'read',
						resources: [
							{
								kind: 'path',
								value: approvalPath,
								canonicalValue: approvalPath,
								boundary: 'external',
							},
						],
					},
				});
				return;
			}
			if (prompt.includes('QUESTION')) {
				pendingRuns.set(runId, sessionId);
				event({
					type: 'question.requested',
					sessionId,
					runId,
					questionId: 'question-1',
					questions: [
						{
							id: 'q1',
							prompt: 'Which?',
							options: [{ label: 'A' }, { label: 'B', description: 'second' }],
							multiSelect: false,
							allowFreeText: false,
						},
					],
				});
				return;
			}
			const stream = /STREAM:(\d+)/.exec(prompt);
			if (stream) return streamRun(sessionId, runId, Number(stream[1]));
			const commitLine = /COMMIT=([^"\n]+?)(?: PR=([^"\n]+?))?(?:"|$)/.exec(prompt);
			const resolvedLines = [...prompt.matchAll(/RESOLVE:([\w-]+)/g)].map(
				(match) => '\nResolved: ' + match[1],
			);
			const mention = /MENTION:([^\s]+)/.exec(prompt);
			return completeRun(
				sessionId,
				runId,
				'done' +
					resolvedLines.join('') +
					(commitLine
						? '\nCommit: ' +
							commitLine[1] +
							(commitLine[2] ? '\nPull request: ' + commitLine[2] : '')
						: ''),
				mention ? mention[1].split(',') : [],
			);
		}
		case 'cancel_run': {
			event({ type: 'run.failed', runId: command.runId, error: 'cancelled' });
			pendingRuns.delete(command.runId);
			return ack(command.id);
		}
		case 'close_session':
			return ack(command.id);
		case 'approve': {
			ack(command.id);
			event({
				type: 'tool.completed',
				runId: command.runId,
				name: 'read_file',
				output: { decision: command.decision, scope: command.scope },
			});
			completeRun(
				command.sessionId,
				command.runId,
				'approved:' + command.decision + ':' + command.scope,
			);
			pendingRuns.delete(command.runId);
			return;
		}
		case 'answer_question': {
			ack(command.id);
			completeRun(command.sessionId, command.runId, 'answered:' + JSON.stringify(command.answers));
			pendingRuns.delete(command.runId);
			return;
		}
		case 'refresh_capabilities': {
			if (!env.FAKE_BRIDGE_SKIP_CAPABILITIES_FRAME) {
				write({
					type: 'bridge.capabilities',
					protocolVersion: version,
					capabilities: [makeCapability('fixture-2.0.0', 'Refreshed')],
				});
			}
			return ack(command.id);
		}
		case 'refresh_mcp_status': {
			event({
				type: 'mcp.status',
				runId: command.runId,
				servers: [{ name: 'fs', status: 'connected' }],
			});
			return ack(command.id);
		}
		case 'suggest_title': {
			if (!env.FAKE_BRIDGE_TITLE) return ack(command.id, 'TITLE_FAILED: no title');
			write({
				type: 'bridge.title',
				protocolVersion: version,
				id: command.id,
				title: env.FAKE_BRIDGE_TITLE,
			});
			return ack(command.id);
		}
		default:
			return ack(command.id, 'unknown command ' + command.cmd);
	}
};
const buffered = [];
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
	const command = JSON.parse(line);
	if (reverse > 0) {
		buffered.push(command);
		if (buffered.length !== reverse) return;
		setTimeout(() => {
			for (const queued of buffered.splice(0).reverse()) ack(queued.id);
		}, 100);
		return;
	}
	handle(command);
});
input.on('close', () => {
	if (heartbeat) clearInterval(heartbeat);
	process.exit(0);
});
