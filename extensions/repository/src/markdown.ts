import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { highlightCode, resolveLanguage } from '@malini/extension-api';
import { tokenSpans } from './code-tokens.js';

export type MarkdownLink = Readonly<
	{ kind: 'web'; url: string } | { kind: 'heading'; slug: string } | { kind: 'file'; path: string }
>;

type MediaUrl = (path: string) => string | null;

type SourceBlock = Readonly<{ line: number; top: number; bottom: number }>;

const MARKDOWN_FILE = /\.(?:md|markdown)$/iu;
const FRONT_MATTER = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/u;
const SOURCE_LINE = 'data-source-line';
const OPENING_TAG = /^<[a-z][a-z\d]*/iu;
const WEB_LINK = /^https?:/iu;
const NOT_A_FILE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const INLINE_MEDIA = /^(?:data|blob):/iu;
const CODE_LANGUAGE = /(?:^|\s)language-(\S+)/u;

export function isMarkdownFile(path: string): boolean {
	return MARKDOWN_FILE.test(path);
}

export function renderMarkdown(
	source: string,
	documentPath: string,
	mediaUrl: MediaUrl,
): DocumentFragment {
	const template = document.createElement('template');
	template.innerHTML = DOMPurify(window).sanitize(linedHtml(source.replace(/\r\n?/gu, '\n')));
	for (const code of template.content.querySelectorAll('pre > code')) {
		const text = code.textContent ?? '';
		const language = resolveLanguage(CODE_LANGUAGE.exec(code.className)?.[1], text);
		code.replaceChildren(...tokenSpans(highlightCode(text, language)));
	}
	for (const image of template.content.querySelectorAll('img')) {
		const url = imageUrl(image.getAttribute('src') ?? '', documentPath, mediaUrl);
		if (url === null) {
			image.replaceWith(image.alt);
			continue;
		}
		image.src = url;
		image.loading = 'eager';
		image.decoding = 'async';
		image.addEventListener('error', () => image.replaceWith(image.alt), { once: true });
	}
	return template.content;
}

export function markdownLineAt(article: ParentNode, y: number): number {
	const blocks = sourceBlocks(article);
	const below = blocks.findIndex((block) => block.bottom > y);
	const index = below === -1 ? blocks.length - 1 : below;
	const block = blocks[index];
	if (!block) return 1;
	const next = blocks[index + 1]?.line ?? block.line + 1;
	const progress = Math.min(1, Math.max(0, (y - block.top) / (block.bottom - block.top)));
	return block.line + Math.floor(progress * (next - block.line));
}

export function markdownLineTop(article: ParentNode, line: number): number | null {
	const blocks = sourceBlocks(article);
	let index = -1;
	for (const [candidate, block] of blocks.entries()) {
		if (block.line <= line) index = candidate;
	}
	const block = blocks[index];
	if (!block) return null;
	const next = blocks[index + 1]?.line ?? block.line + 1;
	const progress = Math.min(1, (line - block.line) / Math.max(1, next - block.line));
	return block.top + progress * (block.bottom - block.top);
}

export function markdownLink(href: string, documentPath: string): MarkdownLink | null {
	if (href.startsWith('#')) return { kind: 'heading', slug: decoded(href.slice(1)) };
	if (WEB_LINK.test(href)) return { kind: 'web', url: href };
	const path = linkedPath(href, documentPath);
	return path === null ? null : { kind: 'file', path };
}

export function markdownHeading(root: ParentNode, slug: string): Element | null {
	const seen = new Map<string, number>();
	for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
		const base = headingSlug(heading.textContent ?? '');
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		if ((count === 0 ? base : `${base}-${String(count)}`) === slug) return heading;
	}
	return null;
}

function linedHtml(text: string): string {
	const content = text.replace(FRONT_MATTER, '');
	const tokens = marked.lexer(content);
	let line = 1 + newlines(text, 0, text.length - content.length);
	let counted = 0;
	let cursor = 0;
	let html = '';
	for (const token of tokens) {
		const at = content.indexOf(token.raw, cursor);
		const start = at === -1 ? cursor : at;
		line += newlines(content, counted, start);
		counted = start;
		if (at !== -1) cursor = at + token.raw.length;
		html += marked
			.parser(Object.assign([token], { links: tokens.links }))
			.replace(OPENING_TAG, `$& ${SOURCE_LINE}="${String(line)}"`);
	}
	return html;
}

function newlines(text: string, from: number, to: number): number {
	let count = 0;
	for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1)) {
		count += 1;
	}
	return count;
}

function sourceBlocks(article: ParentNode): SourceBlock[] {
	const blocks: SourceBlock[] = [];
	for (const element of article.querySelectorAll(`[${SOURCE_LINE}]`)) {
		const box = element.getBoundingClientRect();
		if (box.height === 0) continue;
		blocks.push({
			line: Number(element.getAttribute(SOURCE_LINE)),
			top: box.top,
			bottom: box.bottom,
		});
	}
	return blocks;
}

function headingSlug(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
		.replace(/ /gu, '-');
}

function imageUrl(src: string, documentPath: string, mediaUrl: MediaUrl): string | null {
	if (INLINE_MEDIA.test(src)) return src;
	const path = linkedPath(src, documentPath);
	return path === null ? null : mediaUrl(path);
}

function linkedPath(href: string, documentPath: string): string | null {
	const target = href.replace(/[?#].*$/su, '');
	if (target === '' || NOT_A_FILE.test(target)) return null;
	try {
		const base = new URL(documentPath.split('/').map(encodeURIComponent).join('/'), 'file:///');
		const path = decodeURIComponent(new URL(target, base).pathname);
		const linked = documentPath.startsWith('/') ? path : path.replace(/^\/+/u, '');
		return linked === '' || linked.endsWith('/') ? null : linked;
	} catch {
		return null;
	}
}

function decoded(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

const ARTICLE = '[data-malini-extension] .repository-file-tab__article';

export const MARKDOWN_ARTICLE_STYLES = `
${ARTICLE} {
	--markdown-well: color-mix(in srgb, var(--color-surface-100) 50%, var(--color-surface-50));
	max-width: 42.5rem;
	margin: 0 auto;
	color: var(--color-fg-default);
	font-family: 'Inter Variable', var(--font-sans);
	font-size: 1rem;
	font-optical-sizing: auto;
	line-height: 1.65;
	overflow-wrap: break-word;
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

${ARTICLE} > :first-child {
	margin-top: 0;
}

${ARTICLE} p {
	margin: 0 0 1.625rem;
	line-height: 1.75rem;
}

${ARTICLE} :is(h1, h2, h3, h4, h5, h6) {
	color: var(--color-fg-agent-message-strong);
	font-family: inherit;
	font-weight: 550;
	line-height: 1.75rem;
	scroll-margin-top: 3rem;
}

${ARTICLE} h1 {
	margin: 3.5rem 0 1.25rem;
	font-size: 1.25rem;
	font-weight: 600;
	letter-spacing: -0.011em;
}

${ARTICLE} h2 {
	margin: 3.5rem 0 1.25rem;
	font-size: 1.0625rem;
	letter-spacing: -0.006em;
}

${ARTICLE} h3 {
	margin: 2.25rem 0 0.75rem;
	font-size: 1rem;
}

${ARTICLE} :is(h4, h5, h6) {
	margin: 1.75rem 0 0.5rem;
	font-size: 1rem;
}

${ARTICLE} a {
	color: var(--color-fg-agent-message-strong);
	text-decoration: underline;
	text-decoration-color: color-mix(in srgb, currentColor 24%, transparent);
	text-decoration-thickness: 1.5px;
	text-underline-offset: 3px;
	transition: text-decoration-color 140ms ease;
}

${ARTICLE} a:hover,
${ARTICLE} a:focus-visible {
	text-decoration-color: currentColor;
}

${ARTICLE} a:focus-visible {
	border-radius: 2px;
	outline: 2px solid var(--color-brand);
	outline-offset: 2px;
}

${ARTICLE} strong {
	font-weight: 600;
}

${ARTICLE} em {
	font-family: Georgia, 'Times New Roman', serif;
	font-size: 0.98em;
	font-style: italic;
}

${ARTICLE} :not(pre) > code {
	border: 1px solid var(--color-border-default);
	border-radius: 3px;
	background: var(--markdown-well);
	padding: 1px 6px;
	font-family: var(--font-mono);
	font-size: 0.86em;
	line-height: 1;
}

${ARTICLE} :is(ul, ol) {
	margin: 0 0 1.625rem;
	padding-left: 2.25rem;
}

${ARTICLE} ul {
	list-style: disc;
	padding-left: 1.5rem;
}

${ARTICLE} ol {
	list-style: decimal;
}

${ARTICLE} li {
	margin-bottom: 0.5rem;
	padding-left: 2px;
	line-height: 1.75rem;
}

${ARTICLE} li::marker {
	color: var(--color-fg-agent-message-strong);
	font-weight: 600;
}

${ARTICLE} ol > li::marker {
	font-size: 0.82em;
}

${ARTICLE} ul > li::marker {
	color: var(--color-fg-tertiary);
}

${ARTICLE} li > :is(ul, ol) {
	margin-top: 0.5rem;
}

${ARTICLE} li > :is(p, ul, ol, pre, blockquote):last-child {
	margin-bottom: 0;
}

${ARTICLE} li:has(> input[type='checkbox']),
${ARTICLE} li:has(> p > input[type='checkbox']) {
	list-style: none;
}

${ARTICLE} li input[type='checkbox'] {
	margin: 0 0.5rem 0 -1.375rem;
	opacity: 1;
	vertical-align: -0.0625rem;
}

${ARTICLE} blockquote {
	position: relative;
	margin: 0 0 1.875rem;
	padding: 0.625rem 0 0.625rem 1.25rem;
	color: var(--color-fg-secondary);
	font-family: 'STIX Two Text Variable', ui-serif, Georgia, serif;
	font-size: 1.24em;
	font-style: italic;
	line-height: 2.125rem;
}

${ARTICLE} blockquote::before {
	position: absolute;
	top: 0.375rem;
	bottom: 0.375rem;
	left: 0;
	width: 3px;
	border-radius: 999px;
	background: var(--color-surface-invert);
	content: '';
}

${ARTICLE} blockquote p {
	margin: 0;
	color: inherit;
}

${ARTICLE} blockquote p + p {
	margin-top: 0.75rem;
}

${ARTICLE} blockquote em {
	font-family: inherit;
	font-size: inherit;
}

${ARTICLE} hr {
	height: 1px;
	margin: 2.5rem 0;
	border: 0;
	background: var(--color-border-default);
}

${ARTICLE} pre {
	margin: 0 0 1.625rem;
	overflow-x: auto;
	border-radius: 0.5rem;
	background: var(--markdown-well);
	box-shadow: inset 0 0 0 0.5px var(--color-border-default);
	padding: 1rem 1.125rem;
	color: var(--code-plain);
	font-family: var(--font-mono);
	font-size: 0.84375rem;
	font-variant-ligatures: none;
	line-height: 1.375rem;
}

${ARTICLE} pre code {
	font: inherit;
}

${ARTICLE} :is(img, video) {
	max-width: 100%;
	height: auto;
	margin: 0.5rem 0 1.625rem;
	border-radius: 1rem;
}

${ARTICLE} table {
	width: 100%;
	margin: 0 0 1.625rem;
	border-collapse: collapse;
	font-size: 0.9375rem;
}

${ARTICLE} :is(th, td) {
	border: 1px solid var(--color-border-subtle);
	padding: 0.5rem 0.625rem;
	line-height: 1.5rem;
	text-align: left;
}

${ARTICLE} th {
	background: var(--markdown-well);
	font-size: 0.8125rem;
	font-weight: 550;
}

@media (prefers-reduced-motion: reduce) {
	${ARTICLE} a {
		transition: none;
	}
}
`;
