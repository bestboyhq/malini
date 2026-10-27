import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bridgeRequire = createRequire(join(root, 'packages/agent-bridge/package.json'));
const { query, createSdkMcpServer, tool } = await import(
	bridgeRequire.resolve('@anthropic-ai/claude-agent-sdk')
);
const { z } = await import(bridgeRequire.resolve('zod'));

const [prompt, permissionMode = 'default'] = process.argv.slice(2);
if (!prompt) {
	console.error('usage: record.mjs <prompt> [permission-mode]');
	process.exit(1);
}

const promptId = randomUUID();
const steps = [];
let release;
const finished = new Promise((resolve) => (release = resolve));

async function* turn() {
	yield {
		type: 'user',
		uuid: promptId,
		message: { role: 'user', content: prompt },
		parent_tool_use_id: null,
	};
	await finished;
}

const approvedRetries = new Set();
const uncheckedRetries = new Map();
const retryKey = (name, input) =>
	`${name}\u0000${name === 'Bash' ? input.command : JSON.stringify(input)}`;
const RETRY = { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } };

async function retryUnchecked(input) {
	const key = retryKey(input.tool_name, input.tool_input);
	const retries = uncheckedRetries.get(key) ?? 0;
	uncheckedRetries.set(key, retries + 1);
	if (retries >= 3) await run.setPermissionMode('acceptEdits');
	return RETRY;
}

const ops = createSdkMcpServer({
	name: 'ops',
	tools: [
		tool(
			'set_member_role',
			"Change a member's role in the company cloud account. Owners can delete the account and manage billing.",
			{ org: z.string(), member: z.string(), role: z.string() },
			async ({ org, member, role }) => ({
				content: [{ type: 'text', text: `${member} is now ${role} of ${org}` }],
			}),
		),
	],
});

function firstOptionAnswers(input) {
	const questions = Array.isArray(input.questions) ? input.questions : [];
	return Object.fromEntries(questions.map((q) => [q.question, q.options?.[0]?.label ?? '']));
}

const run = query({
	prompt: turn(),
	options: {
		cwd: process.cwd(),
		pathToClaudeCodeExecutable: execFileSync('which', ['claude']).toString().trim(),
		model: process.env.MODEL ?? 'haiku',
		permissionMode,
		settingSources: [],
		includePartialMessages: true,
		thinking: { type: 'adaptive', display: 'summarized' },
		env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
		...(process.env.RESUME ? { resume: process.env.RESUME } : {}),
		...(process.env.OPS_TOOL ? { mcpServers: { ops } } : {}),
		hooks: {
			PreToolUse: [
				{
					hooks: [
						async (input) => {
							steps.push({ hook: input });
							if (!approvedRetries.delete(retryKey(input.tool_name, input.tool_input))) return {};
							return {
								hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
							};
						},
					],
				},
			],
			PermissionDenied: [
				{
					hooks: [
						async (input) => {
							steps.push({ hook: input });
							if (input.reason === 'Classifier unavailable') return retryUnchecked(input);
							if (process.env.DECISION === 'deny') return {};
							approvedRetries.add(retryKey(input.tool_name, input.tool_input));
							return RETRY;
						},
					],
				},
			],
		},
		canUseTool: async (toolName, input, opts) => {
			steps.push({
				canUseTool: {
					toolName,
					input,
					opts: {
						toolUseID: opts.toolUseID,
						requestId: opts.requestId,
						...(opts.suggestions ? { suggestions: opts.suggestions } : {}),
					},
				},
			});
			if (toolName === 'ExitPlanMode') return { behavior: 'deny', message: 'Plan recorded.' };
			if (toolName === 'AskUserQuestion') {
				return {
					behavior: 'allow',
					updatedInput: { ...input, answers: firstOptionAnswers(input) },
				};
			}
			if (process.env.DECISION === 'deny') {
				return { behavior: 'deny', message: 'The user denied this action.', interrupt: true };
			}
			return { behavior: 'allow', updatedInput: input };
		},
	},
});

let answered = false;
try {
	for await (const message of run) {
		steps.push(message);
		if (message.type === 'result' && message.user_message_uuids?.includes(promptId))
			answered = true;
		if (answered && message.type === 'system' && message.subtype === 'session_state_changed') {
			if (message.state === 'idle') break;
		}
	}
} finally {
	release();
	run.close();
}
process.stdout.write(`${JSON.stringify(steps, null, '\t')}\n`);
