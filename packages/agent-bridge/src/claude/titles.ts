import { tmpdir } from 'node:os';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment } from './session.js';

const TITLE_TIMEOUT_MS = 15_000;
const MAX_TASK_CHARACTERS = 4_000;
const MAX_TITLE_WORDS = 5;
const MAX_TITLE_CHARACTERS = 40;
const TITLE_EDGE = /^["'`*_\s]+|["'`*_.!?,;:\s]+$/gu;

export interface TitleJob {
	readonly instructions: string;
	readonly model: string;
}

export interface TitleOptions {
	readonly findExecutable?: () => string | null;
	readonly query?: typeof sdkQuery;
}

export async function suggestClaudeTitle(
	task: string,
	job: TitleJob,
	options: TitleOptions = {},
): Promise<string> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) throw new Error('Claude Code is not installed');
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), TITLE_TIMEOUT_MS);
	try {
		const conversation = (options.query ?? sdkQuery)({
			prompt: `Name this task:\n\n<task>\n${task.slice(0, MAX_TASK_CHARACTERS)}\n</task>`,
			options: {
				cwd: tmpdir(),
				abortController,
				pathToClaudeCodeExecutable: executable,
				env: claudeEnvironment(),
				model: job.model,
				systemPrompt: job.instructions,
				tools: [],
				maxTurns: 1,
				thinking: { type: 'disabled' },
				settingSources: ['user'],
				settings: { disableAllHooks: true },
				mcpServers: {},
				strictMcpConfig: true,
				persistSession: false,
			},
		});
		for await (const message of conversation) {
			if (message.type !== 'result') continue;
			if (message.subtype !== 'success' || message.is_error) {
				throw new Error(`Claude Code could not name the task: ${message.subtype}`);
			}
			const title = cleanTitle(message.result);
			if (title === null) {
				throw new Error(
					`Claude Code replied with no usable title: ${JSON.stringify(message.result)}`,
				);
			}
			return title;
		}
		throw new Error('Claude Code stopped without naming the task');
	} finally {
		clearTimeout(timeout);
	}
}

export function cleanTitle(reply: string): string | null {
	const lines = reply.split('\n').filter((line) => line.trim().length > 0);
	if (lines.length !== 1) return null;
	const words = (lines[0] ?? '').replace(TITLE_EDGE, '').split(/\s+/u).filter(Boolean);
	const title = words.join(' ');
	if (words.length === 0 || words.length > MAX_TITLE_WORDS) return null;
	if ([...title].length > MAX_TITLE_CHARACTERS) return null;
	return `${title.charAt(0).toLocaleUpperCase()}${title.slice(1)}`;
}
