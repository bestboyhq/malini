import { highlightCode } from '@malini/extension-api';

export function highlightCodeElements(root: ParentNode): void {
	for (const code of root.querySelectorAll('pre > code')) {
		const language = /(?:^|\s)language-(\S+)/u.exec(code.className)?.[1] ?? null;
		const spans = highlightCode(code.textContent ?? '', language).map((token) => {
			const span = code.ownerDocument.createElement('span');
			span.className = `tok-${token.kind}`;
			span.textContent = token.text;
			return span;
		});
		code.classList.add('code-tokens');
		code.replaceChildren(...spans);
	}
}
