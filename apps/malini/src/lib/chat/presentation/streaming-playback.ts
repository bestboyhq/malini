export type TextWidthMeasurer = (text: string) => number;

export function nextCompleteVisualLineChunk(
	source: string,
	startOffset: number,
	maxWidth: number,
	measureText: TextWidthMeasurer,
): string | null {
	const offset = Math.max(0, Math.min(source.length, startOffset));
	if (offset >= source.length || maxWidth <= 0) return null;

	const tokenPattern = /\r\n|\n|[^\S\r\n]+|[^\s]+/gu;
	tokenPattern.lastIndex = offset;
	let lineWidth = 0;
	let match: RegExpExecArray | null;
	while ((match = tokenPattern.exec(source)) !== null) {
		const token = match[0];
		const tokenStart = match.index;
		const tokenEnd = tokenStart + token.length;

		if (token === '\n' || token === '\r\n') {
			return source.slice(offset, tokenEnd);
		}

		const tokenWidth = measureText(token);
		const isWhitespace = /^[^\S\r\n]+$/u.test(token);
		if (!isWhitespace && lineWidth > 0 && lineWidth + tokenWidth > maxWidth) {
			const completeLine = source.slice(offset, tokenStart);
			return completeLine || null;
		}

		lineWidth += tokenWidth;
	}

	return null;
}

export function completeVisualLineChunks(
	source: string,
	maxWidth: number,
	measureText: TextWidthMeasurer,
	includeFinalLine = false,
): string[] {
	if (!source || maxWidth <= 0) return [];

	const chunks: string[] = [];
	const tokenPattern = /\r\n|\n|[^\S\r\n]+|[^\s]+/gu;
	let lineStart = 0;
	let lineWidth = 0;

	for (const match of source.matchAll(tokenPattern)) {
		const token = match[0];
		const tokenStart = match.index;
		const tokenEnd = tokenStart + token.length;

		if (token === '\n' || token === '\r\n') {
			chunks.push(source.slice(lineStart, tokenEnd));
			lineStart = tokenEnd;
			lineWidth = 0;
			continue;
		}

		const tokenWidth = measureText(token);
		const isWhitespace = /^[^\S\r\n]+$/u.test(token);
		if (!isWhitespace && lineWidth > 0 && lineWidth + tokenWidth > maxWidth) {
			const completeLine = source.slice(lineStart, tokenStart);
			if (completeLine) chunks.push(completeLine);
			lineStart = tokenStart;
			lineWidth = tokenWidth;
			continue;
		}

		lineWidth += tokenWidth;
	}

	if (includeFinalLine && lineStart < source.length) {
		chunks.push(source.slice(lineStart));
	}

	return chunks;
}

export const REVEAL_INTERVAL_MS = 220;

export const MIN_REVEAL_INTERVAL_MS = 50;

const STEADY_BACKLOG_LINES = 2;

const COUNTED_BACKLOG_BREAKS = 16;

export function revealIntervalMs(
	source: string,
	revealedLength: number,
	lineCharacters: number,
): number {
	let breaks = 0;
	for (
		let at = source.indexOf('\n', revealedLength);
		at !== -1 && breaks < COUNTED_BACKLOG_BREAKS;
		at = source.indexOf('\n', at + 1)
	) {
		breaks += 1;
	}
	const wrapped = Math.max(0, source.length - revealedLength) / Math.max(1, lineCharacters);
	const backlogLines = Math.max(wrapped, breaks);
	if (backlogLines <= STEADY_BACKLOG_LINES) return REVEAL_INTERVAL_MS;
	return Math.max(
		MIN_REVEAL_INTERVAL_MS,
		(REVEAL_INTERVAL_MS * STEADY_BACKLOG_LINES) / backlogLines,
	);
}
