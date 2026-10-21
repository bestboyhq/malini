import type { DiffHunk, DiffLine, DiffLineKind } from '$shared/repositories/repositories.api';

export type EditDiffstat = { added: number; removed: number };

const REPLACEMENT_FIELD_PAIRS = [
	['old_string', 'new_string'],
	['oldText', 'newText'],
] as const;

const EDIT_LIST_KEYS = ['edits'] as const;

export function editDiffstat(input: unknown): EditDiffstat | null {
	const lines = editHunks(input).flatMap((hunk) => hunk.lines);
	const added = lines.filter((line) => line.kind === 'added').length;
	const removed = lines.filter((line) => line.kind === 'deleted').length;
	return added === 0 && removed === 0 ? null : { added, removed };
}

export function editHunks(input: unknown): DiffHunk[] {
	return replacementEntries(input).map(({ oldText, newText }) => replacementHunk(oldText, newText));
}

function replacementEntries(input: unknown): { oldText: string; newText: string }[] {
	if (!isRecord(input)) return [];

	const direct = replacementPair(input);
	if (direct) return [direct];

	for (const key of EDIT_LIST_KEYS) {
		const list = input[key];
		if (!Array.isArray(list)) continue;
		const entries = list
			.map((entry) => replacementPair(entry))
			.filter((entry): entry is { oldText: string; newText: string } => entry !== null);
		if (entries.length > 0) return entries;
	}

	return [];
}

function replacementPair(value: unknown): { oldText: string; newText: string } | null {
	if (!isRecord(value)) return null;
	for (const [oldKey, newKey] of REPLACEMENT_FIELD_PAIRS) {
		const oldText = value[oldKey];
		const newText = value[newKey];
		if (typeof oldText === 'string' && typeof newText === 'string') return { oldText, newText };
	}
	return null;
}

function replacementHunk(oldText: string, newText: string): DiffHunk {
	const oldLines = splitLines(oldText);
	const newLines = splitLines(newText);

	let start = 0;
	while (
		start < oldLines.length &&
		start < newLines.length &&
		oldLines[start] === newLines[start]
	) {
		start += 1;
	}

	let oldEnd = oldLines.length;
	let newEnd = newLines.length;
	while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
		oldEnd -= 1;
		newEnd -= 1;
	}

	return {
		header: '',
		oldStart: 0,
		oldLines: oldLines.length,
		newStart: 0,
		newLines: newLines.length,
		lines: [
			...oldLines.slice(0, start).map((text) => unnumbered('context', text)),
			...oldLines.slice(start, oldEnd).map((text) => unnumbered('deleted', text)),
			...newLines.slice(start, newEnd).map((text) => unnumbered('added', text)),
			...oldLines.slice(oldEnd).map((text) => unnumbered('context', text)),
		],
	};
}

function unnumbered(kind: DiffLineKind, text: string): DiffLine {
	return { kind, oldLine: null, newLine: null, text };
}

function splitLines(text: string): string[] {
	return text === '' ? [] : text.replaceAll('\r\n', '\n').split('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
