import { highlightedCodeHtml } from './code-html';

export function highlightCodeElements(root: ParentNode): void {
	for (const code of root.querySelectorAll('pre > code')) {
		const language = /(?:^|\s)language-(\S+)/u.exec(code.className)?.[1] ?? null;
		code.classList.add('code-tokens');
		code.innerHTML = highlightedCodeHtml(code.textContent ?? '', language);
	}
}
