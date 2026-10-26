import { tmpdir } from 'node:os';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { isRecord } from '../type-guards.js';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment } from './session.js';
import type { TitleJob, TitleOptions } from './titles.js';

const CHOICE_TIMEOUT_MS = 20_000;
const MAX_TASK_CHARACTERS = 8_000;
const STRUCTURED_OUTPUT_TURNS = 2;

export async function chooseClaudeCandidate(
	task: string,
	job: TitleJob,
	choices: number,
	options: TitleOptions = {},
): Promise<number> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) throw new Error('Claude Code is not installed');
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), CHOICE_TIMEOUT_MS);
	try {
		const conversation = (options.query ?? sdkQuery)({
			prompt: task.slice(0, MAX_TASK_CHARACTERS),
			options: {
				cwd: tmpdir(),
				abortController,
				pathToClaudeCodeExecutable: executable,
				env: claudeEnvironment(),
				model: job.model,
				systemPrompt: job.instructions,
				tools: [],
				maxTurns: STRUCTURED_OUTPUT_TURNS,
				thinking: { type: 'disabled' },
				settingSources: ['user'],
				settings: { disableAllHooks: true },
				mcpServers: {},
				strictMcpConfig: true,
				persistSession: false,
				outputFormat: { type: 'json_schema', schema: pickSchema(choices) },
			},
		});
		for await (const message of conversation) {
			if (message.type !== 'result') continue;
			if (message.subtype !== 'success' || message.is_error) {
				throw new Error(`Claude Code could not pick a candidate: ${message.subtype}`);
			}
			const pick = validPick(message.structured_output, choices);
			if (pick === null) {
				throw new Error(
					`Claude Code picked no candidate from 1 to ${choices}: ${JSON.stringify(message.structured_output)}`,
				);
			}
			return pick;
		}
		throw new Error('Claude Code stopped without picking a candidate');
	} finally {
		clearTimeout(timeout);
	}
}

export function pickSchema(choices: number): Record<string, unknown> {
	return {
		type: 'object',
		properties: { pick: { type: 'integer', minimum: 1, maximum: choices } },
		required: ['pick'],
		additionalProperties: false,
	};
}

export function validPick(output: unknown, choices: number): number | null {
	const pick = isRecord(output) ? output['pick'] : undefined;
	return typeof pick === 'number' && Number.isSafeInteger(pick) && pick >= 1 && pick <= choices
		? pick
		: null;
}
