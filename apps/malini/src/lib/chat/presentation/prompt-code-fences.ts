export type PromptTextPart = Readonly<
	| { kind: 'text'; text: string }
	| { kind: 'code'; open: string; code: string; language: string; close: string }
>;

const CLOSED_FENCE = /^([ \t]*(`{3,}|~{3,})([^\n`]*)\n)([\s\S]*?)(\n[ \t]*\2[ \t]*)$/gmu;
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/gu;

export function promptCodeFences(text: string): readonly PromptTextPart[] {
	const parts: PromptTextPart[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CLOSED_FENCE)) {
		const [whole, open = '', , info = '', code = '', close = ''] = match;
		if (match.index > cursor) parts.push(textPart(text.slice(cursor, match.index)));
		parts.push({ kind: 'code', open, code, language: info.trim(), close });
		cursor = match.index + whole.length;
	}
	if (cursor < text.length) parts.push(textPart(text.slice(cursor)));
	return parts;
}

function textPart(markdown: string): PromptTextPart {
	return { kind: 'text', text: markdown.replace(MARKDOWN_ESCAPE, '$1') };
}
