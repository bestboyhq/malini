import type { CodeToken, DiffLineSide } from './code-highlight.js';

type Span = readonly [start: number, end: number];

export type ChangedSpans = Readonly<{ before: readonly Span[]; after: readonly Span[] }>;

const WORD = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const MAX_WORD_PAIRS = 40_000;
const MIN_SHARED_TEXT = 0.4;

export function markLineChanges(
	lines: readonly Readonly<{ text: string; side: DiffLineSide }>[],
	tokens: readonly (readonly CodeToken[])[],
): (readonly CodeToken[])[] {
	const marked = [...tokens];
	let removed: number[] = [];
	let added: number[] = [];
	const pairRun = (): void => {
		for (const [pair, before] of removed.entries()) {
			const after = added[pair];
			const beforeLine = lines[before];
			const afterLine = lines[after ?? -1];
			if (after === undefined || !beforeLine || !afterLine) break;
			const spans = changedSpans(beforeLine.text, afterLine.text);
			if (!spans) continue;
			marked[before] = markTokens(marked[before] ?? [], spans.before);
			marked[after] = markTokens(marked[after] ?? [], spans.after);
		}
		removed = [];
		added = [];
	};
	for (const [index, { side }] of lines.entries()) {
		if (side === 'both' || (side === 'old' && added.length > 0)) pairRun();
		if (side === 'old') removed.push(index);
		if (side === 'new') added.push(index);
	}
	pairRun();
	return marked;
}

export function changedSpans(before: string, after: string): ChangedSpans | null {
	const beforeWords = before.match(WORD) ?? [];
	const afterWords = after.match(WORD) ?? [];
	if (beforeWords.length * afterWords.length > MAX_WORD_PAIRS) return null;
	const [keptBefore, keptAfter] = commonWords(beforeWords, afterWords);
	const shared = beforeWords
		.filter((word, index) => keptBefore[index] && word.trim() !== '')
		.join('').length;
	const longest = Math.max(before.replace(/\s/gu, '').length, after.replace(/\s/gu, '').length);
	if (longest === 0 || shared < longest * MIN_SHARED_TEXT) return null;
	return {
		before: spans(before, beforeWords, keptBefore),
		after: spans(after, afterWords, keptAfter),
	};
}

function commonWords(
	before: readonly string[],
	after: readonly string[],
): [readonly boolean[], readonly boolean[]] {
	const width = after.length + 1;
	const lengths = new Uint16Array((before.length + 1) * width);
	for (let row = before.length - 1; row >= 0; row -= 1) {
		for (let column = after.length - 1; column >= 0; column -= 1) {
			lengths[row * width + column] =
				before[row] === after[column]
					? (lengths[(row + 1) * width + column + 1] ?? 0) + 1
					: Math.max(
							lengths[(row + 1) * width + column] ?? 0,
							lengths[row * width + column + 1] ?? 0,
						);
		}
	}
	const keptBefore = before.map(() => false);
	const keptAfter = after.map(() => false);
	let row = 0;
	let column = 0;
	while (row < before.length && column < after.length) {
		if (before[row] === after[column]) {
			keptBefore[row] = true;
			keptAfter[column] = true;
			row += 1;
			column += 1;
		} else if (
			(lengths[(row + 1) * width + column] ?? 0) >= (lengths[row * width + column + 1] ?? 0)
		) {
			row += 1;
		} else {
			column += 1;
		}
	}
	return [keptBefore, keptAfter];
}

function spans(text: string, words: readonly string[], kept: readonly boolean[]): Span[] {
	const changed: [number, number][] = [];
	let offset = 0;
	for (const [index, word] of words.entries()) {
		const end = offset + word.length;
		if (!kept[index]) {
			const last = changed.at(-1);
			if (last && text.slice(last[1], offset).trim() === '') last[1] = end;
			else changed.push([offset, end]);
		}
		offset = end;
	}
	return changed;
}

function markTokens(tokens: readonly CodeToken[], changed: readonly Span[]): CodeToken[] {
	const marked: CodeToken[] = [];
	let offset = 0;
	for (const token of tokens) {
		const end = offset + token.text.length;
		let cursor = offset;
		for (const [start, stop] of changed) {
			if (stop <= cursor || start >= end) continue;
			const from = Math.max(start, cursor);
			const to = Math.min(stop, end);
			if (from > cursor)
				marked.push({ ...token, text: token.text.slice(cursor - offset, from - offset) });
			marked.push({ ...token, text: token.text.slice(from - offset, to - offset), changed: true });
			cursor = to;
		}
		if (cursor < end) marked.push({ ...token, text: token.text.slice(cursor - offset) });
		offset = end;
	}
	return marked;
}
