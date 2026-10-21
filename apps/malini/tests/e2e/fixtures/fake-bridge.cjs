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
const approvalPath =
	env.FAKE_BRIDGE_APPROVAL_PATH ||
	nodePath.join(fs.realpathSync(require('node:os').tmpdir()), 'outside.txt');
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
const signedInEmail = () => {
	if (!env.FAKE_BRIDGE_CLAUDE_ACCOUNT_FILE) return null;
	try {
		return fs.readFileSync(env.FAKE_BRIDGE_CLAUDE_ACCOUNT_FILE, 'utf8').trim() || null;
	} catch {
		return null;
	}
};
const makeCapability = (capabilityVersion, message) => {
	const email = signedInEmail();
	const claudeState = email ? 'ready' : env.FAKE_BRIDGE_CLAUDE_STATE || 'ready';
	return {
		state: claudeState,
		installed: claudeState !== 'missing',
		authenticated: claudeState === 'ready' ? true : claudeState === 'needs_auth' ? false : null,
		version: claudeState === 'missing' ? null : capabilityVersion,
		account:
			claudeState === 'ready' ? { email: email ?? 'e2e@example.com', plan: 'Claude Max' } : null,
		models: [
			{
				id: 'opus',
				label: 'Opus',
				description: 'Fixture opus',
				efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
			},
			{
				id: 'sonnet',
				label: 'Sonnet',
				description: 'Fixture sonnet',
				efforts: ['low', 'medium', 'high', 'max'],
			},
		],
		defaultModel: 'opus',
		message,
	};
};
const CHAT_STALLED_BRIDGE = nodePath.join(env.HOME || '/tmp', 'chat-stalled-bridge');
if (fs.existsSync(CHAT_STALLED_BRIDGE)) process.exit(1);
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
const finalUsage = env.FAKE_BRIDGE_USAGE ? JSON.parse(env.FAKE_BRIDGE_USAGE) : {};
const pendingRuns = new Map();
const blockedRuns = new Set();
const BLOCKED_TOOL = 'mcp__ops__set_member_role';
const BLOCKED_INPUT = { org: 'acme', member: 'vendor-sync-bot', role: 'owner' };
const lastRuns = new Map();
const askedQuestions = new Map();
const askQuestion = (sessionId, runId, questionId, toolCallId, prompt, labels) => {
	const asked = askedQuestions.get(runId) ?? { questions: new Map(), answers: [] };
	asked.questions.set(questionId, { toolCallId, prompt });
	askedQuestions.set(runId, asked);
	event({
		type: 'tool.started',
		runId,
		name: 'AskUserQuestion',
		toolCallId,
		input: { questions: [{ question: prompt }] },
	});
	event({
		type: 'question.requested',
		sessionId,
		runId,
		questionId,
		toolName: 'AskUserQuestion',
		toolCallId,
		questions: [
			{
				id: 'q1',
				prompt,
				options: labels.map((label, index) =>
					index === labels.length - 1 ? { label, description: 'second' } : { label },
				),
				multiSelect: false,
				allowFreeText: false,
			},
		],
	});
};
const worktrees = new Map();
const event = (frame) => write(frame);
const completeRun = (sessionId, runId, summary, mentions = [], shownImages = [], appended = '') => {
	const mentioned = mentions.map((path) => '`' + path + '`').join(' and ');
	const shown = shownImages.map((path) => '\n\n![' + path + '](' + path + ')').join('');
	event({ type: 'assistant.delta', runId, contentId: 'c1', text: 'partial ' });
	event({
		type: 'assistant.message',
		runId,
		contentId: 'c1',
		text:
			(mentioned
				? 'Hello from the fake bridge. See ' + mentioned + '.'
				: 'Hello from the fake bridge') +
			shown +
			appended,
	});
	event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5, interim: true });
	event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5, ...finalUsage });
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
const THINK_STEP_MS = 700;
const THOUGHTS = [
	[
		'The user wants the preview fixed. ',
		'It stays open after the gallery closes.\n\n',
		'Focus returns to the chip that opened it. ',
		'I should read the hover card first.\n\n',
	],
	['The hover card opens on any focus. ', 'I will gate it on keyboard focus.\n\n'],
];
const thinkRun = (sessionId, runId) => {
	pendingRuns.set(runId, sessionId);
	const steps = [];
	THOUGHTS.forEach((chunks, index) => {
		const contentId = 'thought-' + index;
		steps.push(() => event({ type: 'thinking.delta', runId, contentId, text: '' }));
		for (const text of chunks) {
			steps.push(() => event({ type: 'thinking.delta', runId, contentId, text }));
		}
		steps.push(() => event({ type: 'thinking.message', runId, contentId, text: chunks.join('') }));
		for (const file of ['src/a.ts', 'src/b.ts']) {
			const toolCallId = contentId + '-' + file;
			steps.push(() => {
				event({
					type: 'tool.started',
					runId,
					name: 'Read',
					toolCallId,
					input: { file_path: file },
				});
				event({ type: 'tool.completed', runId, name: 'Read', toolCallId, output: 'ok' });
			});
		}
	});
	const timer = setInterval(() => {
		if (!pendingRuns.has(runId)) return clearInterval(timer);
		const next = steps.shift();
		if (next) return next();
		clearInterval(timer);
		pendingRuns.delete(runId);
		completeRun(sessionId, runId, 'done');
	}, THINK_STEP_MS);
};
const HEAVY_CODE = Array.from(
	{ length: 32 },
	(_, line) =>
		`export function step${line}(input: number): number {\n\treturn input * ${line} + ${line};\n}`,
).join('\n');
const heavyRun = (sessionId, runId, steps) => {
	for (let step = 0; step < steps; step += 1) {
		const id = runId + '-' + step;
		event({
			type: 'thinking.message',
			runId,
			contentId: 'think-' + id,
			text: 'Step ' + step + ' needs the file list and a small edit. '.repeat(6),
		});
		event({
			type: 'tool.started',
			runId,
			name: 'Bash',
			toolCallId: 'bash-' + id,
			input: { command: 'rg --files src | head -300', description: 'List source files ' + step },
		});
		event({
			type: 'tool.completed',
			runId,
			name: 'Bash',
			toolCallId: 'bash-' + id,
			output: Array.from(
				{ length: 300 },
				(_, line) => 'src/module-' + step + '/file-' + line + '.ts',
			).join('\n'),
		});
		event({
			type: 'tool.started',
			runId,
			name: 'Read',
			toolCallId: 'read-' + id,
			input: { file_path: 'src/step-' + step + '.ts' },
		});
		event({
			type: 'tool.completed',
			runId,
			name: 'Read',
			toolCallId: 'read-' + id,
			output: HEAVY_CODE,
		});
		event({
			type: 'tool.started',
			runId,
			name: 'Edit',
			toolCallId: 'edit-' + id,
			input: {
				file_path: 'src/step-' + step + '.ts',
				old_string: 'return input;\nkeep',
				new_string: 'return input * 2;\nkeep\nadded',
			},
		});
		event({ type: 'tool.completed', runId, name: 'Edit', toolCallId: 'edit-' + id, output: 'ok' });
		event({
			type: 'assistant.message',
			runId,
			contentId: 'text-' + id,
			text:
				'## Step ' +
				step +
				'\n\nI read `src/step-' +
				step +
				'.ts` and changed **one** line. ' +
				'The change keeps the _public_ API and only doubles the input.\n\n' +
				'- First, the list of files\n- Then the read\n- Then the [edit](https://example.com)\n\n' +
				'```ts\n' +
				HEAVY_CODE +
				'\n```\n\n| file | lines |\n| --- | --- |\n| step-' +
				step +
				'.ts | 96 |',
		});
	}
	completeRun(sessionId, runId, 'done');
};
const bigBashRun = (sessionId, runId, lines) => {
	const toolCallId = 'big-bash-' + runId;
	event({
		type: 'tool.started',
		runId,
		name: 'Bash',
		toolCallId,
		input: { command: 'cat build.log', description: 'Read the build log' },
	});
	event({
		type: 'tool.completed',
		runId,
		name: 'Bash',
		toolCallId,
		output: Array.from({ length: lines }, (_, line) => 'build line ' + (line + 1)).join('\n'),
	});
	completeRun(sessionId, runId, 'done');
};
const RICH_MARKDOWN =
	'\n\n## Rendering check\n\nI changed `src/app.ts` and kept notes in /Users/ada/notes.md for **it**.\n\n' +
	'- First point\n- Second point with a [link](https://example.com)\n\n' +
	'```ts\n' +
	HEAVY_CODE +
	'\n```\n\n| file | lines |\n| --- | --- |\n| app.ts | 96 |';
const CHAT_TURN_REPORT =
	'\n\n- Changed: the header is `position: sticky`.\n- Verified: checked at 320 px and 1440 px.\n\n' +
	'Outcome: The header stays pinned while the page scrolls.\n' +
	'Needs: Approve the new shadow; Merge the pull request';
const BACKGROUND_RELEASE = 'release-background-agent';
const backgroundAgentRun = (sessionId, runId, releasePath) => {
	pendingRuns.set(runId, sessionId);
	const toolCallId = 'agent-' + runId;
	const agentTask = {
		taskId: 'agent-task-' + runId,
		kind: 'agent',
		description: 'Sleep probe',
		startedAt: Date.now(),
		toolCallId,
	};
	event({
		type: 'tool.started',
		runId,
		name: 'Agent',
		toolCallId,
		input: {
			description: 'Sleep probe',
			subagent_type: 'general-purpose',
			run_in_background: true,
			prompt: 'Run sleep 15 && echo probe-done and reply with its output.',
		},
	});
	event({ type: 'background.updated', runId, waiting: false, tasks: [agentTask] });
	event({ type: 'assistant.message', runId, contentId: 'launched', text: 'launched' });
	const timer = setInterval(() => {
		if (!pendingRuns.has(runId)) return clearInterval(timer);
		if (!fs.existsSync(releasePath)) return;
		clearInterval(timer);
		pendingRuns.delete(runId);
		event({ type: 'background.updated', runId, waiting: false, tasks: [] });
		event({
			type: 'tool.completed',
			runId,
			name: 'Agent',
			toolCallId,
			output: 'Command completed. Output: probe-done',
		});
		event({
			type: 'assistant.message',
			runId,
			contentId: 'follow-up',
			text: 'The Sleep probe agent finished with probe-done.',
		});
		event({ type: 'run.completed', runId, summary: 'The Sleep probe agent finished.' });
		event({ type: 'session.state', sessionId, status: 'completed' });
	}, 50);
};
const backgroundCommands = new Map();
const backgroundCommandTask = (startedAt) => ({
	taskId: 'bash-e2e',
	kind: 'command',
	description: 'Run the e2e suite',
	startedAt,
	toolCallId: 'bash-e2e-call',
	detail: '✓ 212 passed · 2 running',
});
const waitOnBackgroundCommand = (sessionId, runId, text) => {
	const { startedAt } = backgroundCommands.get(sessionId);
	backgroundCommands.set(sessionId, { runId, startedAt });
	pendingRuns.set(runId, sessionId);
	event({ type: 'assistant.message', runId, contentId: 'reply-' + runId, text });
	event({
		type: 'background.updated',
		runId,
		waiting: true,
		tasks: [backgroundCommandTask(startedAt)],
		summary: text,
	});
};
const startBackgroundCommand = (sessionId, runId) => {
	const startedAt = Date.now() - 95_000;
	backgroundCommands.set(sessionId, { runId, startedAt });
	const toolCallId = 'bash-e2e-call';
	event({
		type: 'tool.started',
		runId,
		name: 'Bash',
		toolCallId,
		input: {
			command: 'pnpm --filter malini test:e2e',
			description: 'Run the e2e suite',
			run_in_background: true,
		},
	});
	event({
		type: 'tool.completed',
		runId,
		name: 'Bash',
		toolCallId,
		output: 'Command running in background with ID: bash-e2e.',
	});
	event({
		type: 'background.updated',
		runId,
		waiting: false,
		tasks: [backgroundCommandTask(startedAt)],
	});
};
const backgroundCommandRun = (sessionId, runId) => {
	startBackgroundCommand(sessionId, runId);
	waitOnBackgroundCommand(sessionId, runId, 'Started the e2e suite in the background.');
};
const busyBackgroundCommandRun = (sessionId, runId) => {
	startBackgroundCommand(sessionId, runId);
	pendingRuns.set(runId, sessionId);
	event({
		type: 'tool.started',
		runId,
		name: 'Bash',
		toolCallId: 'sleep-e2e-call',
		input: { command: 'sleep 600', description: 'Wait for the deploy' },
	});
};
const handOffBackgroundCommand = (sessionId, runId, steer) => {
	const waiting = backgroundCommands.get(sessionId);
	event({ type: 'background.updated', runId: waiting.runId, waiting: false, tasks: [] });
	event(
		steer
			? { type: 'run.failed', runId: waiting.runId, error: 'cancelled' }
			: {
					type: 'run.completed',
					runId: waiting.runId,
					summary: 'Started the e2e suite in the background.',
					handedOff: true,
				},
	);
	pendingRuns.delete(waiting.runId);
	event({ type: 'run.started', runId, sessionId });
	event({
		type: 'background.updated',
		runId,
		waiting: false,
		tasks: [backgroundCommandTask(waiting.startedAt)],
	});
	waitOnBackgroundCommand(sessionId, runId, 'Answered while the e2e suite keeps running.');
};
const stopBackgroundCommand = (sessionId) => {
	const waiting = backgroundCommands.get(sessionId);
	if (!waiting) return;
	backgroundCommands.delete(sessionId);
	pendingRuns.delete(waiting.runId);
	event({ type: 'background.updated', runId: waiting.runId, waiting: false, tasks: [] });
	event({ type: 'run.completed', runId: waiting.runId, summary: 'The e2e suite was stopped.' });
	event({ type: 'session.state', sessionId, status: 'completed' });
};
const HELD_RUNS = nodePath.join(env.HOME || '/tmp', 'hold-agent-runs');
const FIXTURE_SKILLS = [
	{
		name: 'animate',
		description: 'Design web animations that feel right',
		source: 'personal',
		tokens: 315,
	},
	{
		name: 'humanizer',
		description: 'Rewrite AI-sounding text so it reads naturally',
		source: 'personal',
		tokens: 102,
	},
	{
		name: 'landing-arch',
		description: 'An 8-section conversion landing page',
		source: 'personal',
		tokens: 193,
	},
	{
		name: 'adr',
		description: 'Record an architecture decision',
		source: 'repository',
		tokens: 128,
	},
	{
		name: 'test-malini-app',
		description: 'Verify a change in the real app',
		source: 'repository',
		tokens: 62,
	},
	{
		name: 'ponytail:ponytail',
		description: 'Forces the laziest solution that works',
		source: 'plugin',
		tokens: 282,
	},
	{
		name: 'dataviz',
		description: 'Charts that read as one system',
		source: 'claude-code',
		tokens: 482,
	},
];
const skillsOfRun = new Map();
const themeOfRun = new Map();
const respond = async (sessionId, runId, prompt) => {
	const worktree = worktrees.get(sessionId);
	if (prompt.includes('WHICH_THEME')) {
		event({
			type: 'assistant.message',
			runId,
			contentId: 'c1',
			text: 'Theme: ' + (themeOfRun.get(runId) ?? 'none'),
		});
		event({ type: 'run.completed', runId, summary: 'done' });
		event({ type: 'session.state', sessionId, status: 'completed' });
		return;
	}
	if (prompt.includes('WHICH_SKILLS')) {
		const skills = skillsOfRun.get(runId);
		event({
			type: 'assistant.message',
			runId,
			contentId: 'c1',
			text: 'Skills: ' + (skills ? skills.join(', ') || 'none' : 'all'),
		});
		event({ type: 'run.completed', runId, summary: 'done' });
		event({ type: 'session.state', sessionId, status: 'completed' });
		return;
	}
	for (const edit of prompt.matchAll(/EDIT:([^\s]+)/g)) {
		if (!worktree) break;
		fs.mkdirSync(worktree, { recursive: true });
		fs.writeFileSync(nodePath.join(worktree, edit[1]), 'agent edit ' + runId + '\n');
		event({ type: 'file.changed', runId, path: edit[1] });
	}
	if (worktree && prompt.includes('Fix the failing checks')) {
		fs.writeFileSync(nodePath.join(worktree, 'checks-fixed.txt'), 'fixed by ' + runId + '\n');
		event({ type: 'file.changed', runId, path: 'checks-fixed.txt' });
	}
	if (worktree && prompt.includes('up to date with its base branch')) {
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
			if (index % 500 === 0) {
				await new Promise(setImmediate);
				fs.mkdirSync(directory, { recursive: true });
			}
			fs.writeFileSync(nodePath.join(directory, 'file-' + index + '.txt'), 'a\nb\nc\n');
		}
	}
	if (prompt.includes('HANG')) {
		pendingRuns.set(runId, sessionId);
		return;
	}
	if (prompt.includes('AUTO_MODE_BLOCK')) {
		pendingRuns.set(runId, sessionId);
		blockedRuns.add(runId);
		event({
			type: 'tool.started',
			runId,
			name: BLOCKED_TOOL,
			toolCallId: 'blocked-1',
			input: BLOCKED_INPUT,
		});
		event({
			type: 'approval.requested',
			sessionId,
			runId,
			approvalId: 'approval-blocked-1',
			reason: 'Blocked by auto mode: Permission Grant',
			toolName: BLOCKED_TOOL,
			input: BLOCKED_INPUT,
			permission: {
				capability: 'external-service',
				resources: [{ kind: 'service', value: 'ops', boundary: 'external' }],
			},
			autoModeRule: BLOCKED_TOOL,
		});
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
	if (prompt.includes('QUESTION_PAIR')) {
		pendingRuns.set(runId, sessionId);
		askQuestion(sessionId, runId, 'question-1', 'ask-1', 'Which?', ['A', 'B']);
		askQuestion(sessionId, runId, 'question-2', 'ask-2', 'Where?', ['Here', 'There']);
		return;
	}
	if (prompt.includes('QUESTION')) {
		pendingRuns.set(runId, sessionId);
		askQuestion(sessionId, runId, 'question-1', 'ask-1', 'Which?', ['A', 'B']);
		return;
	}
	if (prompt.includes('BACKGROUND_COMMAND')) return backgroundCommandRun(sessionId, runId);
	if (prompt.includes('BACKGROUND_BUSY')) return busyBackgroundCommandRun(sessionId, runId);
	if (prompt.includes('BACKGROUND_AGENT')) {
		return backgroundAgentRun(sessionId, runId, nodePath.join(env.HOME, BACKGROUND_RELEASE));
	}
	const bigOutput = /BIG_OUTPUT:(\d+)/.exec(prompt);
	if (bigOutput) {
		const toolCallId = 'big-' + runId;
		const lines = Array.from({ length: Number(bigOutput[1]) * 16 }, (_, line) =>
			('big output line ' + line + ' ').padEnd(63, '.'),
		);
		event({
			type: 'tool.started',
			runId,
			name: 'Bash',
			toolCallId,
			input: { command: 'cat big.log', description: 'Print the big log' },
		});
		event({
			type: 'tool.completed',
			runId,
			name: 'Bash',
			toolCallId,
			output: lines.join('\n') + '\nend of big output',
		});
		return completeRun(sessionId, runId, 'big output done');
	}
	const heavy = /HEAVY:(\d+)/.exec(prompt);
	if (heavy) return heavyRun(sessionId, runId, Number(heavy[1]));
	const bigBash = /BIG_BASH:(\d+)/.exec(prompt);
	if (bigBash) return bigBashRun(sessionId, runId, Number(bigBash[1]));
	if (prompt.includes('THINK')) return thinkRun(sessionId, runId);
	if (prompt.includes('EDIT_TOOL')) {
		const input = {
			file_path: 'notes.md',
			old_string: 'keep\nold line',
			new_string: 'keep\nnew one\nnew two',
		};
		event({ type: 'tool.started', runId, name: 'Edit', toolCallId: 'edit-notes', input });
		event({ type: 'tool.completed', runId, name: 'Edit', toolCallId: 'edit-notes', output: 'ok' });
	}
	if (prompt.includes('READ_TOOL')) {
		const input = { file_path: 'src/app.ts', offset: 10, limit: 3 };
		event({ type: 'tool.started', runId, name: 'Read', toolCallId: 'read-app', input });
		event({
			type: 'tool.completed',
			runId,
			name: 'Read',
			toolCallId: 'read-app',
			output: '10\texport function ready(): boolean {\n11\t\treturn true;\n12\t}',
		});
	}
	if (prompt.includes('BASH_FAIL')) {
		event({
			type: 'tool.started',
			runId,
			name: 'Bash',
			toolCallId: 'bash-fail',
			input: { command: 'pnpm lint', description: 'Lint the workspace' },
		});
		event({
			type: 'tool.failed',
			runId,
			name: 'Bash',
			toolCallId: 'bash-fail',
			error: 'ESLint found 3 problems\n  src/a.ts  1:1  error',
		});
	}
	const stream = /STREAM:(\d+)/.exec(prompt);
	if (stream) return streamRun(sessionId, runId, Number(stream[1]));
	const commitLine = /COMMIT=([^"\n]+?)(?: PR=([^"\n]+?))?(?:"|$)/.exec(prompt);
	const resolvedLines = [...prompt.matchAll(/RESOLVE:([\w-]+)/g)].map(
		(match) => '\nResolved: ' + match[1],
	);
	for (const [, path] of prompt.matchAll(/READ_IMAGE:([^\s]+)/g)) {
		const toolCallId = 'read-' + path;
		event({
			type: 'tool.started',
			runId,
			name: 'Read',
			toolCallId,
			input: { file_path: path },
		});
		event({
			type: 'tool.completed',
			runId,
			name: 'Read',
			toolCallId,
			output: '[image]',
		});
	}
	if (prompt.includes('IMPLEMENTABLE_PLAN') && !prompt.includes('Add the health route')) {
		event({
			type: 'plan.updated',
			runId,
			text: '1. Add the health route\n2. Cover it with a test',
		});
	}
	if (prompt.includes('ROUTINE_RUN_FAIL')) {
		event({ type: 'run.failed', runId, error: 'the tests are still red' });
		event({ type: 'session.state', sessionId, status: 'failed' });
		return;
	}
	const browserOpen = /BROWSER_OPEN:([^\s]+)/.exec(prompt);
	if (browserOpen) {
		write({
			type: 'bridge.browser_request',
			protocolVersion: version,
			requestId: 'browser-' + runId,
			sessionId,
			action: 'open',
			url: browserOpen[1],
		});
	}
	if (prompt.includes('CHAT_BASH_EXIT')) {
		const toolCallId = 'bash-exit-' + runId;
		const input = { command: 'pnpm test', description: 'Run the unit tests' };
		event({ type: 'tool.started', runId, name: 'Bash', toolCallId, input });
		event({
			type: 'tool.failed',
			runId,
			name: 'Bash',
			toolCallId,
			error: 'Exit code 1\n1 test failed',
		});
	}
	if (prompt.includes('CHAT_HANDOFF')) {
		event({
			type: 'assistant.message',
			runId,
			contentId: 'malini.context-handoff:' + runId,
			text: 'Context handed off',
		});
	}
	if (prompt.includes('CHAT_PLAN')) {
		event({ type: 'plan.updated', runId, text: '# Add a health endpoint\n\n- Route it' });
	}
	if (prompt.includes('CHAT_STALL')) {
		fs.writeFileSync(CHAT_STALLED_BRIDGE, '');
		if (heartbeat) clearInterval(heartbeat);
		pendingRuns.set(runId, sessionId);
		return;
	}
	if (prompt.includes('CHAT_TURN_REPORT')) {
		return completeRun(
			sessionId,
			runId,
			'done',
			[],
			[...prompt.matchAll(/SHOW_IMAGE:([^\s]+)/g)].map((match) => match[1]),
			CHAT_TURN_REPORT,
		);
	}
	const mention = /MENTION:([^\s]+)/.exec(prompt);
	return completeRun(
		sessionId,
		runId,
		'done' +
			resolvedLines.join('') +
			(commitLine
				? '\nCommit: ' + commitLine[1] + (commitLine[2] ? '\nPull request: ' + commitLine[2] : '')
				: ''),
		mention ? mention[1].split(',') : [],
		[...prompt.matchAll(/SHOW_IMAGE:([^\s]+)/g)].map((match) => match[1]),
		prompt.includes('RICH_MARKDOWN')
			? RICH_MARKDOWN
			: prompt.includes('WIDE_CODE')
				? '\n\n```sh\n' + 'echo wide '.repeat(60) + '\n```'
				: prompt.includes('CODE')
					? '\n\n```sh\npnpm --filter malini test\n```'
					: '',
	);
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
			if (command.prompt.includes('REFUSED_PROMPT'))
				return ack(command.id, 'the agent refused this');
			ack(command.id);
			const { sessionId, runId, prompt } = command;
			if (prompt.includes('CRASH')) process.exit(3);
			lastRuns.set(sessionId, runId);
			if (command.skills) skillsOfRun.set(runId, command.skills);
			if (command.theme) themeOfRun.set(runId, command.theme);
			if (backgroundCommands.has(sessionId)) {
				return handOffBackgroundCommand(sessionId, runId, command.steer);
			}
			for (const [steered, owner] of pendingRuns) {
				if (!command.steer || owner !== sessionId) continue;
				pendingRuns.delete(steered);
				event({ type: 'run.failed', runId: steered, error: 'cancelled' });
			}
			const start = () => {
				event({ type: 'run.started', runId, sessionId });
				if (!fs.existsSync(HELD_RUNS)) return respond(sessionId, runId, prompt);
				pendingRuns.set(runId, sessionId);
				const held = setInterval(() => {
					if (!pendingRuns.has(runId)) return clearInterval(held);
					if (fs.existsSync(HELD_RUNS)) return;
					clearInterval(held);
					pendingRuns.delete(runId);
					respond(sessionId, runId, prompt);
				}, 50);
			};
			if (prompt.includes('DELAYED_START')) return void setTimeout(start, 1_500);
			return start();
		}
		case 'stop_task': {
			stopBackgroundCommand(command.sessionId);
			return ack(command.id);
		}
		case 'cancel_run': {
			backgroundCommands.delete(command.sessionId);
			event({ type: 'run.failed', runId: command.runId, error: 'cancelled' });
			pendingRuns.delete(command.runId);
			return ack(command.id);
		}
		case 'close_session':
			return ack(command.id);
		case 'approve': {
			ack(command.id);
			if (blockedRuns.delete(command.runId)) {
				event({
					type: 'tool.failed',
					runId: command.runId,
					name: BLOCKED_TOOL,
					toolCallId: 'blocked-1',
					error:
						'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Permission Grant].',
					autoModeReason: 'Permission Grant',
				});
				if (command.decision === 'allow') {
					event({
						type: 'tool.started',
						runId: command.runId,
						name: BLOCKED_TOOL,
						toolCallId: 'retried-1',
						input: BLOCKED_INPUT,
					});
					event({
						type: 'tool.completed',
						runId: command.runId,
						name: BLOCKED_TOOL,
						toolCallId: 'retried-1',
						output: 'vendor-sync-bot is now owner of acme',
					});
				}
				completeRun(
					command.sessionId,
					command.runId,
					['blocked', command.decision, command.alwaysAllow ? 'always' : command.scope].join(':'),
				);
				pendingRuns.delete(command.runId);
				return;
			}
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
			const asked = askedQuestions.get(command.runId);
			const question = asked?.questions.get(command.questionId);
			if (!asked || !question) return;
			asked.questions.delete(command.questionId);
			asked.answers.push(...command.answers);
			event({
				type: 'tool.completed',
				runId: command.runId,
				name: 'AskUserQuestion',
				toolCallId: question.toolCallId,
				output:
					'Your questions have been answered: ' +
					command.answers
						.map((answer) => '"' + question.prompt + '"="' + answer.values.join(', ') + '"')
						.join(', ') +
					'. You can now continue with these answers in mind.',
			});
			if (asked.questions.size > 0) return;
			askedQuestions.delete(command.runId);
			completeRun(command.sessionId, command.runId, 'answered:' + JSON.stringify(asked.answers));
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
		case 'refresh_session_status': {
			const runId = lastRuns.get(command.sessionId);
			if (!runId) return ack(command.id);
			event({ type: 'mcp.status', runId, servers: [{ name: 'fs', status: 'connected' }] });
			if (env.FAKE_BRIDGE_REFRESHED_CONTEXT) {
				const context = JSON.parse(env.FAKE_BRIDGE_REFRESHED_CONTEXT);
				event({ type: 'usage.updated', runId, ...context, interim: true });
			}
			return ack(command.id);
		}
		case 'list_skills': {
			write({
				type: 'bridge.skills',
				protocolVersion: version,
				id: command.id,
				skills: FIXTURE_SKILLS,
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
		case 'browser_result':
			return ack(command.id);
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
