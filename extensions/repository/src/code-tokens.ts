import { highlightDiffLines, type CodeToken, type DiffLineSide } from '@malini/extension-api';
import type { DiffLine } from './domain.js';

export type ChangeTag = 'ins' | 'del';

export function tokenSpans(
	tokens: readonly CodeToken[],
	change: ChangeTag | null = null,
): HTMLElement[] {
	return tokens.map((token) => {
		const span = document.createElement(token.changed && change ? change : 'span');
		span.className = `tok-${token.kind}`;
		span.textContent = token.text;
		return span;
	});
}

export function diffLineTokens(
	lines: readonly DiffLine[],
	language: string | null,
): (readonly CodeToken[])[] {
	return highlightDiffLines(diffLineSides(lines), language);
}

export function diffLineSides(
	lines: readonly DiffLine[],
): Readonly<{ text: string; side: DiffLineSide }>[] {
	return lines.map(({ kind, text }) => ({
		text,
		side: kind === 'deletion' ? 'old' : kind === 'addition' ? 'new' : 'both',
	}));
}

export function changeTag(kind: DiffLine['kind']): ChangeTag | null {
	return kind === 'addition' ? 'ins' : kind === 'deletion' ? 'del' : null;
}
