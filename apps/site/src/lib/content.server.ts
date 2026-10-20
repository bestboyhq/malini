import { Marked } from 'marked';
import { createHighlighter } from 'shiki';
import { SITE_DESCRIPTION, SITE_URL } from '$lib/links';

export type DocPage = Readonly<{
	slug: string;
	path: string;
	title: string;
	description: string;
	section: string;
	markdown: string;
	source: string;
}>;

export type Heading = Readonly<{ id: string; text: string; depth: number }>;

const NAV: readonly (readonly [string, readonly string[]])[] = [
	['Get started', ['', 'install', 'updates']],
	['Using Malini', ['workstreams', 'chat', 'jobs', 'routines']],
	['Build on Malini', ['agent-tools', 'extensions', 'reference/events']],
];

const NAV_ORDER = NAV.flatMap(([, slugs]) => slugs);

const files = import.meta.glob<string>('/content/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
});

function slugOf(file: string): string {
	return file
		.replace(/^\/content\//u, '')
		.replace(/\.md$/u, '')
		.replace(/(^|\/)index$/u, '');
}

function unquote(value: string): string {
	return value.trim().replace(/^(['"])(.*)\1$/u, '$2');
}

function sectionOf(slug: string): string {
	return NAV.find(([, slugs]) => slugs.includes(slug))?.[0] ?? 'More';
}

function parse(slug: string, source: string): DocPage {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source);
	const fields = new Map(
		(frontmatter?.[1] ?? '').split('\n').flatMap((line) => {
			const colon = line.indexOf(':');
			return colon > 0
				? [[line.slice(0, colon).trim(), unquote(line.slice(colon + 1))] as const]
				: [];
		}),
	);
	let markdown = source.slice(frontmatter?.[0].length ?? 0).trim();
	const heading = /^# (.+)\r?\n/u.exec(markdown);
	if (heading) markdown = markdown.slice(heading[0].length).trim();
	return {
		slug,
		path: slug ? `/docs/${slug}` : '/docs',
		title: fields.get('title') ?? heading?.[1]?.trim() ?? slug,
		description: fields.get('description') ?? '',
		section: sectionOf(slug),
		markdown,
		source,
	};
}

function rank(slug: string): number {
	const index = NAV_ORDER.indexOf(slug);
	return index === -1 ? NAV_ORDER.length : index;
}

export const pages: readonly DocPage[] = Object.entries(files)
	.map(([file, source]) => parse(slugOf(file), source))
	.sort((left, right) => rank(left.slug) - rank(right.slug) || left.slug.localeCompare(right.slug));

export function findPage(slug: string): DocPage | undefined {
	return pages.find((page) => page.slug === slug);
}

export function navSections(): { title: string; items: { path: string; title: string }[] }[] {
	const sections = new Map<string, { path: string; title: string }[]>();
	for (const page of pages) {
		sections.set(page.section, [
			...(sections.get(page.section) ?? []),
			{ path: page.path, title: page.title },
		]);
	}
	return [...sections].map(([title, items]) => ({ title, items }));
}

const highlighter = await createHighlighter({
	themes: ['github-light', 'github-dark-default'],
	langs: ['ts', 'json', 'sh'],
});

function highlight(code: string, lang: string): string {
	const known = highlighter.getLoadedLanguages().includes(lang);
	return highlighter.codeToHtml(code, {
		lang: known ? lang : 'text',
		themes: { light: 'github-light', dark: 'github-dark-default' },
		defaultColor: false,
	});
}

function plain(html: string): string {
	return html
		.replace(/<[^>]+>/gu, '')
		.replace(/&amp;/gu, '&')
		.replace(/&lt;/gu, '<')
		.replace(/&gt;/gu, '>')
		.replace(/&quot;/gu, '"')
		.replace(/&#39;/gu, "'");
}

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s-]/gu, '')
			.trim()
			.replace(/\s+/gu, '-') || 'section'
	);
}

const DOCS_LINK = /^\/malini(\/docs[^#?]*?)(\.md)?(?=$|[#?])/u;

let headings: Heading[] = [];
let ids = new Map<string, number>();

const markdown = new Marked({
	gfm: true,
	walkTokens(token) {
		if (token.type === 'link') token.href = token.href.replace(DOCS_LINK, '/malini$1');
	},
	renderer: {
		link({ href, tokens }) {
			const docsPath = DOCS_LINK.exec(href)?.[1];
			if (docsPath === undefined || pages.some((page) => page.path === docsPath)) return false;
			return this.parser.parseInline(tokens);
		},
		heading({ tokens, depth }) {
			const html = this.parser.parseInline(tokens);
			const text = plain(html);
			const base = slugify(text);
			const taken = ids.get(base) ?? 0;
			ids.set(base, taken + 1);
			const id = taken === 0 ? base : `${base}-${taken}`;
			headings.push({ id, text, depth });
			return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${html}</a></h${depth}>\n`;
		},
		code({ text, lang }) {
			return `<div class="code">${highlight(text, lang ?? 'text')}</div>\n`;
		},
	},
});

export function renderMarkdown(source: string): { html: string; headings: Heading[] } {
	headings = [];
	ids = new Map();
	const html = markdown.parse(source, { async: false });
	return { html, headings };
}

export function asMarkdownDocument(page: DocPage): string {
	return `# ${page.title}\n\n${page.description ? `> ${page.description}\n\n` : ''}${page.markdown}\n`;
}

export function llmsText(): string {
	const links = pages.map(
		(page) =>
			`- [${page.title}](${SITE_URL}${page.path}.md)${page.description ? `: ${page.description}` : ''}`,
	);
	return `# Malini\n\n> ${SITE_DESCRIPTION}\n\nEvery page below is plain markdown. [llms-full.txt](${SITE_URL}/llms-full.txt) holds all of them in one file.\n\n## Docs\n\n${links.join('\n')}\n`;
}
