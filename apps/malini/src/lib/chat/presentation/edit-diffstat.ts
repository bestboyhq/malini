export type EditDiffstat = { added: number; removed: number };

const REPLACEMENT_FIELD_PAIRS = [
	['old_string', 'new_string'],
	['oldText', 'newText'],
	['oldString', 'newString'],
	['old_str', 'new_str'],
] as const;

const EDIT_LIST_KEYS = ['edits', 'replacements'] as const;

export function editDiffstat(input: unknown): EditDiffstat | null {
	const total = { added: 0, removed: 0 };
	let counted = false;

	for (const entry of replacementEntries(input)) {
		const stat = replacementDiffstat(entry.oldText, entry.newText);
		total.added += stat.added;
		total.removed += stat.removed;
		counted = true;
	}

	if (!counted) return null;
	return total.added === 0 && total.removed === 0 ? null : total;
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

function replacementDiffstat(oldText: string, newText: string): EditDiffstat {
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

	return { added: newEnd - start, removed: oldEnd - start };
}

function splitLines(text: string): string[] {
	return text === '' ? [] : text.replaceAll('\r\n', '\n').split('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
