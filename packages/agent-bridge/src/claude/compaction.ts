import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { HookCallback, Settings } from '@anthropic-ai/claude-agent-sdk';
import type { ConversationHistoryMessage, HistoryResult } from '../protocol.js';
import { isRecord } from '../type-guards.js';
import { userSettingsFile } from './user-settings.js';

export const COMPACT_WINDOW_TOKENS = 280_000;
export const RECORD_PARTS = 48;
export const HOOK_CONTEXT_CHARACTERS = 10_000;
const SHORTEST_PART_CHARACTERS = 8_000;
const RECORD_INTRO =
	'Malini keeps every message of this chat word for word. Your context was just compacted, so here is the conversation before the compaction as the user saw it in Malini: each message they wrote and each reply you gave, in order. Tool calls and their output are not included.';

export function compactWindowSettings(cwd: string): Settings | undefined {
	const files = [
		userSettingsFile(),
		join(cwd, '.claude', 'settings.json'),
		join(cwd, '.claude', 'settings.local.json'),
	];
	return files.some(setsCompactWindow) ? undefined : { autoCompactWindow: COMPACT_WINDOW_TOKENS };
}

export function picksCompactWindow(prompt: string): boolean {
	return /^\/autocompact\s+\S/u.test(prompt);
}

// ponytail: a window picked for any one model keeps Malini's off for every model; copy the per-model picks into the flag layer if that matters
function setsCompactWindow(file: string): boolean {
	let settings: unknown;
	try {
		settings = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return false;
	}
	if (!isRecord(settings)) return false;
	if (settings['autoCompactWindow'] !== undefined) return true;
	const models = settings['modelSettings'];
	return (
		isRecord(models) &&
		Object.values(models).some(
			(model) => isRecord(model) && model['autoCompactWindow'] !== undefined,
		)
	);
}

export function previousConversation(messages: readonly ConversationHistoryMessage[]): string {
	const transcript = messages
		.map((message) => `[${message.role}] ${message.content.trim()}`)
		.join('\n\n');
	return `<previous_conversation>\n${transcript}\n</previous_conversation>`;
}

export function recordParts(messages: readonly ConversationHistoryMessage[]): string[] {
	if (messages.length === 0) return [];
	const parts: string[] = [];
	let rest = `${RECORD_INTRO}\n\n${previousConversation(messages)}`;
	while (rest.length > HOOK_CONTEXT_CHARACTERS) {
		const newline = rest.lastIndexOf('\n', HOOK_CONTEXT_CHARACTERS);
		if (newline >= SHORTEST_PART_CHARACTERS) {
			parts.push(rest.slice(0, newline));
			rest = rest.slice(newline + 1);
			continue;
		}
		const cut = splitsPair(rest, HOOK_CONTEXT_CHARACTERS)
			? HOOK_CONTEXT_CHARACTERS - 1
			: HOOK_CONTEXT_CHARACTERS;
		parts.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	parts.push(rest);
	return parts;
}

function splitsPair(text: string, at: number): boolean {
	const code = text.charCodeAt(at - 1);
	return code >= 0xd800 && code <= 0xdbff;
}

export function recordHooks(requestHistory: () => Promise<HistoryResult>): HookCallback[] {
	let compaction: Compaction | null = null;
	return Array.from({ length: RECORD_PARTS }, (_, index): HookCallback => async (input) => {
		if (input.hook_event_name !== 'SessionStart' || input.agent_id !== undefined) return {};
		if (!compaction || compaction.handedOut.has(index)) {
			compaction = new Compaction(loadParts(requestHistory));
		}
		const part = await compaction.part(index);
		return part === undefined
			? {}
			: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: part } };
	});
}

async function loadParts(requestHistory: () => Promise<HistoryResult>): Promise<string[]> {
	const history = await requestHistory().catch((error: unknown): HistoryResult => ({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	}));
	if (history.ok) return recordParts(history.messages ?? []);
	process.stderr.write(`[claude] could not put the chat record back: ${history.error ?? ''}\n`);
	return [];
}

class Compaction {
	readonly handedOut = new Set<number>();
	readonly #parts: Promise<readonly string[]>;
	readonly #returned = Array.from({ length: RECORD_PARTS }, gate);

	constructor(parts: Promise<readonly string[]>) {
		this.#parts = parts;
	}

	async part(index: number): Promise<string | undefined> {
		this.handedOut.add(index);
		const parts = await this.#parts;
		const previous = this.#returned[index - 1];
		if (previous) {
			await previous.opened;
			await nextTurn();
		}
		this.#returned[index]?.open();
		return parts[index];
	}
}

function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}
