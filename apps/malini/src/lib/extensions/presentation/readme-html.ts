import DOMPurify from 'dompurify';
import { marked } from 'marked';

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const LEVELS_BELOW_THE_PAGE = 2;

export function readmeFragment(markdown: string, title: string): DocumentFragment {
	const template = document.createElement('template');
	template.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { async: false }));
	const first = template.content.firstElementChild;
	if (first?.matches(HEADINGS) && sameWords(first.textContent ?? '', title)) first.remove();
	for (const heading of template.content.querySelectorAll(HEADINGS)) {
		const level = Math.min(Number(heading.tagName.slice(1)) + LEVELS_BELOW_THE_PAGE, 6);
		const lower = document.createElement(`h${level}`);
		lower.append(...heading.childNodes);
		heading.replaceWith(lower);
	}
	return template.content;
}

function sameWords(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}
