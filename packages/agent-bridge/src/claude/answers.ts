import { tmpdir } from 'node:os';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { isRecord } from '../type-guards.js';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment } from './session.js';
import type { TitleAutomation, TitleOptions } from './titles.js';

const ANSWER_TIMEOUT_MS = 20_000;
const MAX_TASK_CHARACTERS = 8_000;
const STRUCTURED_OUTPUT_TURNS = 2;

export async function answerClaude(
	task: string,
	automation: TitleAutomation,
	schema: Readonly<Record<string, unknown>>,
	options: TitleOptions = {},
): Promise<Record<string, unknown>> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) throw new Error('Claude Code is not installed');
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), ANSWER_TIMEOUT_MS);
	try {
		const conversation = (options.query ?? sdkQuery)({
			prompt: task.slice(0, MAX_TASK_CHARACTERS),
			options: {
				cwd: tmpdir(),
				abortController,
				pathToClaudeCodeExecutable: executable,
				env: claudeEnvironment(automation.env),
				model: automation.model,
				systemPrompt: automation.instructions,
				tools: [],
				maxTurns: STRUCTURED_OUTPUT_TURNS,
				thinking: { type: 'disabled' },
				settingSources: ['user'],
				settings: { disableAllHooks: true },
				mcpServers: {},
				strictMcpConfig: true,
				persistSession: false,
				outputFormat: { type: 'json_schema', schema: { ...schema } },
			},
		});
		for await (const message of conversation) {
			if (message.type !== 'result') continue;
			if (message.subtype !== 'success' || message.is_error) {
				throw new Error(`Claude Code could not answer: ${message.subtype}`);
			}
			if (!isRecord(message.structured_output)) {
				throw new Error(
					`Claude Code gave no answer object: ${JSON.stringify(message.structured_output)}`,
				);
			}
			return message.structured_output;
		}
		throw new Error('Claude Code stopped without answering');
	} finally {
		clearTimeout(timeout);
	}
}
