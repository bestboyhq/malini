import { invariant } from '$main/errors';
import { isRecord } from '$main/db/rows';
import {
	promptChipFallbackLabel,
	promptChipSegments,
	type PromptChipRef,
} from '$lib/chat/domain/prompt-chip';
import {
	isHistoryEventKind,
	seqInSupersededRange,
	supersededRanges,
	type AgentEventRow,
} from './events.repository';

export const MAX_FORK_TRANSCRIPT_BYTES = 200 * 1024;

const SECTION_SEPARATOR = '\n\n';
const TRUNCATED = '\n\n[truncated]';
const ELISION_RESERVE_BYTES = 64;
const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f/\\]+/gu;
const MAX_FILE_TITLE_BYTES = 200;

export function forkTranscriptFileName(chatName: string): string {
	const title = chatTitle(chatName).replace(UNSAFE_FILE_NAME_CHARACTERS, ' ').trim() || 'Chat';
	return `Transcript of ${clipBytes(title, MAX_FILE_TITLE_BYTES)}.md`;
}

export function forkTranscript(
	chatName: string,
	rows: readonly AgentEventRow[],
	atSeq: number,
	maxBytes: number = MAX_FORK_TRANSCRIPT_BYTES,
): string {
	const forkRunId = rows.find((row) => row.seq === atSeq)?.runId;
	if (forkRunId === undefined) throw invariant(`no event at seq \`${atSeq}\` in this chat`);
	const cut = rows.reduce(
		(max, row) =>
			row.runId === forkRunId && !isHistoryEventKind(row.kind) ? Math.max(max, row.seq) : max,
		atSeq,
	);
	const history = rows.filter((row) => row.seq <= cut);
	const ranges = supersededRanges(history);
	const obsoleted = obsoletedRunIds(history);
	const sections = groupRuns(history)
		.filter(
			(run) =>
				run.runId === forkRunId ||
				!(obsoleted.has(run.runId) || seqInSupersededRange(run.openingSeq, ranges)),
		)
		.map((run) => renderRun(run.rows))
		.filter((section) => section.length > 0);
	const header = `# Transcript of ${chatTitle(chatName)}`;
	const budget = maxBytes - byteLength(header) - SECTION_SEPARATOR.length - 1;
	return `${[header, ...withinBudget(sections, budget)].join(SECTION_SEPARATOR)}\n`;
}

type RunRows = { runId: string; openingSeq: number; rows: AgentEventRow[] };

function groupRuns(rows: readonly AgentEventRow[]): RunRows[] {
	const runs = new Map<string, RunRows>();
	for (const row of rows) {
		if (isHistoryEventKind(row.kind)) continue;
		const run = runs.get(row.runId) ?? { runId: row.runId, openingSeq: row.seq, rows: [] };
		if (row.kind === 'user.message' && !run.rows.some((seen) => seen.kind === 'user.message')) {
			run.openingSeq = row.seq;
		}
		run.rows.push(row);
		runs.set(row.runId, run);
	}
	return [...runs.values()];
}

function obsoletedRunIds(rows: readonly AgentEventRow[]): Set<string> {
	const obsoleted = new Set<string>();
	for (const row of rows) {
		if (row.kind === 'run.obsoleted') obsoleted.add(row.runId);
		if (row.kind === 'run.restored') obsoleted.delete(row.runId);
	}
	return obsoleted;
}

function renderRun(rows: readonly AgentEventRow[]): string {
	const user = rows.flatMap((row) => (row.kind === 'user.message' ? userBlocks(row.payload) : []));
	const prose = rows.flatMap((row) =>
		row.kind === 'assistant.message' || row.kind === 'plan.updated'
			? nonEmpty(text(row.payload, 'text'))
			: [],
	);
	const assistant = [
		...prose,
		...toolLine(rows),
		...summaryLine(rows, prose),
		...rows.flatMap((row) => (row.kind === 'run.failed' ? failureLine(row.payload) : [])),
	];
	return [
		...(user.length > 0 ? ['## User', ...user] : []),
		...(assistant.length > 0 ? ['## Assistant', ...assistant] : []),
	].join(SECTION_SEPARATOR);
}

function userBlocks(payload: unknown): string[] {
	const attachments = namedReferences(payload, 'attachments', 'id', 'displayName');
	const transcripts = namedReferences(payload, 'transcriptReferences', 'sessionId', 'label');
	const segments = promptChipSegments(text(payload, 'text'));
	const prompt = segments
		.map((segment) =>
			segment.kind === 'text'
				? segment.text
				: chipText(segment.ref, segment.ref.kind === 'transcript' ? transcripts : attachments),
		)
		.join('');
	const inline = new Set(
		segments.flatMap((segment) => (segment.kind === 'chip' ? [segment.ref.id] : [])),
	);
	const unmentioned = [...attachments].flatMap(([id, name]) => (inline.has(id) ? [] : [name]));
	return [
		...nonEmpty(prompt),
		...(unmentioned.length > 0 ? [`[Attached: ${unmentioned.join(', ')}]`] : []),
	];
}

function namedReferences(
	payload: unknown,
	key: string,
	idKey: string,
	nameKey: string,
): Map<string, string> {
	const references = isRecord(payload) ? payload[key] : undefined;
	if (!Array.isArray(references)) return new Map();
	return new Map(
		references.flatMap((reference) => {
			const id = text(reference, idKey);
			const name = text(reference, nameKey).trim();
			return id && name ? [[id, name] as const] : [];
		}),
	);
}

function chipText(ref: PromptChipRef, names: ReadonlyMap<string, string>): string {
	const label =
		ref.kind === 'context'
			? ref.id
			: ref.kind === 'attachment' || ref.kind === 'transcript'
				? names.get(ref.id)
				: promptChipFallbackLabel(ref);
	return label ? `[${ref.kind}: ${label}]` : `[${ref.kind}]`;
}

function toolLine(rows: readonly AgentEventRow[]): string[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (row.kind !== 'tool.started') continue;
		const name = text(row.payload, 'name').trim() || 'tool';
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
	if (total === 0) return [];
	const breakdown = [...counts]
		.sort(
			([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
		)
		.map(([name, count]) => `${count} ${name}`)
		.join(', ');
	return [`[${total} tool ${total === 1 ? 'call' : 'calls'} elided: ${breakdown}]`];
}

function summaryLine(rows: readonly AgentEventRow[], prose: readonly string[]): string[] {
	const said = compact(prose.join(' '));
	return rows.flatMap((row) => {
		if (row.kind !== 'run.completed') return [];
		const summary = compact(text(row.payload, 'summary'));
		return summary.length > 0 && !said.includes(summary) ? [`[Result: ${summary}]`] : [];
	});
}

function failureLine(payload: unknown): string[] {
	const error = compact(text(payload, 'error'));
	if (error === 'cancelled') return ['[Run cancelled]'];
	return [`[Run failed: ${error || 'unknown error'}]`];
}

function withinBudget(sections: readonly string[], maxBytes: number): string[] {
	if (byteLength(sections.join(SECTION_SEPARATOR)) <= maxBytes) return [...sections];
	const [first, ...rest] = sections;
	if (first === undefined) return [];
	if (rest.length === 0) return [clip(first, maxBytes)];
	const head = clip(first, Math.floor(maxBytes / 4));
	const tail: string[] = [];
	let remaining = maxBytes - byteLength(head) - ELISION_RESERVE_BYTES;
	for (let index = rest.length - 1; index >= 0; index -= 1) {
		const section = rest[index] ?? '';
		const fitted =
			tail.length === 0 ? clip(section, remaining - SECTION_SEPARATOR.length) : section;
		const cost = byteLength(fitted) + SECTION_SEPARATOR.length;
		if (cost > remaining) break;
		tail.unshift(fitted);
		remaining -= cost;
	}
	const elided = rest.length - tail.length;
	if (elided === 0) return [head, ...tail];
	return [head, `[${elided} ${elided === 1 ? 'run' : 'runs'} elided]`, ...tail];
}

function clip(section: string, maxBytes: number): string {
	if (byteLength(section) <= maxBytes) return section;
	return `${clipBytes(section, Math.max(0, maxBytes - TRUNCATED.length))}${TRUNCATED}`;
}

function clipBytes(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value);
	if (bytes.length <= maxBytes) return value;
	return new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true });
}

function chatTitle(chatName: string): string {
	return chatName.trim() || 'Chat';
}

function text(payload: unknown, key: string): string {
	const value = isRecord(payload) ? payload[key] : undefined;
	return typeof value === 'string' ? value : '';
}

function nonEmpty(value: string): string[] {
	const trimmed = value.trim();
	return trimmed.length > 0 ? [trimmed] : [];
}

function compact(value: string): string {
	return value.replace(/\s+/gu, ' ').trim();
}

function byteLength(value: string): number {
	return Buffer.byteLength(value);
}
