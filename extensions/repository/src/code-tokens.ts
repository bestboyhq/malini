import {
	highlightCode,
	normalizeLanguage,
	type CodeToken,
	type SupportedLanguage,
} from '@malini/extension-api';

export function languageForPath(path: string): SupportedLanguage | null {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return null;
	return normalizeLanguage(name.slice(dot + 1));
}

export function tokenSpans(tokens: readonly CodeToken[]): HTMLSpanElement[] {
	return tokens.map((token) => {
		const span = document.createElement('span');
		span.className = `tok-${token.kind}`;
		span.textContent = token.text;
		return span;
	});
}

export function highlightLine(path: string, text: string): readonly CodeToken[] {
	return highlightCode(text, languageForPath(path));
}

export function highlightFileLines(path: string, contents: string): (readonly CodeToken[])[] {
	const lines: CodeToken[][] = [[]];
	for (const token of highlightCode(contents, languageForPath(path))) {
		const parts = token.text.split('\n');
		for (const [index, part] of parts.entries()) {
			if (index > 0) lines.push([]);
			if (part.length === 0) continue;
			lines[lines.length - 1]?.push({ kind: token.kind, text: part });
		}
	}
	return lines;
}
