import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord } from '$main/db/rows';
import { parseTurnReport, userPromptText } from '$lib/chat/chat.platform';
import {
	RETIRED_HOME_SCOPE_KEY,
	parseLeadScope,
	workstreamRepositoryName,
} from '$shared/repositories/repositories.platform';
import { isMissing } from './brain-git';
import { saveCapturedSeq, uncapturedPrompts, type TypedPromptRow } from './brain-store.repository';
import {
	capturedChats,
	logDay,
	logSection,
	redactBrainText,
	type TypedPrompt,
} from './capture-log';

export type CaptureScope = Readonly<{
	checkout: string;
	brainProjectId: string | null;
	sinceSeq: number;
	secrets: readonly string[];
	home: string;
	now: Date;
}>;

export type CaptureResult = Readonly<{ chats: number; turns: number; logPath: string | null }>;

export async function captureTypedChats(
	db: MaliniDatabase,
	scope: CaptureScope,
): Promise<CaptureResult> {
	const redact = (text: string): string => redactBrainText(text, scope.home, scope.secrets);
	const places = new Map<string, string>();
	const prompts: TypedPrompt[] = [];
	for (const row of uncapturedPrompts(db, scope.brainProjectId, scope.sinceSeq)) {
		const text = typedText(row.event);
		if (text === null) continue;
		const place = places.get(row.workstreamId) ?? (await placeOf(db, row));
		places.set(row.workstreamId, place);
		const outcome = row.summary === null ? null : parseTurnReport(row.summary).outcome;
		prompts.push({
			seq: row.seq,
			sessionId: row.sessionId,
			runId: row.runId,
			chatName: redact(row.chatName),
			place,
			text: redact(text),
			outcome: outcome === null ? null : redact(outcome),
			finished: row.completedAt !== null,
		});
	}
	const chats = capturedChats(prompts);
	if (chats.length === 0) return { chats: 0, turns: 0, logPath: null };
	const day = logDay(scope.now);
	const logPath = `log/${day}.md`;
	const file = join(scope.checkout, logPath);
	const body = chats.map(logSection).join('\n\n');
	await mkdir(dirname(file), { recursive: true });
	await appendFile(file, (await isMissing(file)) ? `# ${day}\n\n${body}\n` : `\n${body}\n`);
	for (const chat of chats) saveCapturedSeq(db, chat.sessionId, chat.lastSeq);
	const turns = chats.reduce((sum, chat) => sum + chat.turns.length, 0);
	return { chats: chats.length, turns, logPath };
}

function typedText(event: string): string | null {
	let payload: unknown;
	try {
		payload = JSON.parse(event.slice(event.indexOf('\n') + 1));
	} catch {
		return null;
	}
	if (!isRecord(payload) || payload['from'] !== undefined) return null;
	const text = userPromptText(payload).trim();
	return text.length > 0 ? text : null;
}

async function placeOf(db: MaliniDatabase, row: TypedPromptRow): Promise<string> {
	const scope = parseLeadScope(row.scope);
	if (scope) return scope.owner;
	if (row.scope === RETIRED_HOME_SCOPE_KEY) return 'Home';
	return (await workstreamRepositoryName(db, row.workstreamId)) ?? 'a removed repository';
}
