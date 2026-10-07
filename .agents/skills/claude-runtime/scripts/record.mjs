import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bridgeRequire = createRequire(join(root, 'packages/agent-bridge/package.json'));
const { query } = await import(bridgeRequire.resolve('@anthropic-ai/claude-agent-sdk'));

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
		...(process.env.RESUME ? { resume: process.env.RESUME } : {}),
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

try {
	for await (const message of run) {
		steps.push(message);
		if (message.type === 'result' && message.user_message_uuids?.includes(promptId)) break;
	}
} finally {
	release();
	run.close();
}
process.stdout.write(`${JSON.stringify(steps, null, '\t')}\n`);
