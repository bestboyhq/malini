import { highlightDiffLines, type CodeToken } from '@malini/extension-api';
import type { DiffLine } from './domain.js';

export function tokenSpans(tokens: readonly CodeToken[]): HTMLSpanElement[] {
	return tokens.map((token) => {
		const span = document.createElement('span');
		span.className = `tok-${token.kind}`;
		span.textContent = token.text;
		return span;
	});
}

export function diffLineTokens(
	lines: readonly DiffLine[],
	language: string | null,
): (readonly CodeToken[])[] {
	return highlightDiffLines(
		lines.map(({ kind, text }) => ({
			text,
			side: kind === 'deletion' ? 'old' : kind === 'addition' ? 'new' : 'both',
		})),
		language,
	);
}
