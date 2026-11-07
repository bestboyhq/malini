import { Marked } from 'marked';
import { createHighlighter } from 'shiki';
import type { DocDemo } from '$lib/DocDemo.svelte';
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

export type DocBlock = Readonly<{ html: string }> | Readonly<{ demo: DocDemo }>;

const NAV: readonly (readonly [string, readonly string[]])[] = [
	['Get started', ['', 'install', 'updates']],
	['Using Malini', ['workstreams', 'chat', 'automations', 'profile']],
	['Build on Malini', ['agent-tools', 'extensions', 'reference/events']],
];

const NAV_ORDER = NAV.flatMap(([, slugs]) => slugs);

const DEMO = /^<!-- demo (\S+) (\d+)\n(.+)\n((?:- .+\n)*)-->\n*/gmu;
const DEMO_MARK = /<!--demo:(\d+)-->\n?/u;

export function withoutDemos(source: string): string {
	return source.replace(DEMO, '');
}

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
		source: withoutDemos(source),
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

function renderMarkdown(source: string): { html: string; headings: Heading[] } {
	headings = [];
	ids = new Map();
	const html = markdown.parse(source, { async: false });
	return { html, headings };
}

type Directive = Readonly<{ workstream: string; height: number; lead: string; tries: string[] }>;

function sectionTitle(html: string): string {
	const id = [...html.matchAll(/<h2 id="([^"]+)"/gu)].at(-1)?.[1];
	return headings.find((heading) => heading.id === id)?.text ?? '';
}

export function renderDoc(source: string): { blocks: DocBlock[]; headings: Heading[] } {
	const directives: Directive[] = [];
	const marked = source.replace(
		DEMO,
		(_, workstream: string, height: string, lead: string, tries: string) => {
			directives.push({
				workstream,
				height: Number(height),
				lead,
				tries: tries.split('\n').flatMap((line) => (line ? [line.slice(2)] : [])),
			});
			return `<!--demo:${directives.length - 1}-->\n\n`;
		},
	);
	const rendered = renderMarkdown(marked);
	const blocks: DocBlock[] = [];
	let rest = rendered.html;
	for (let mark = DEMO_MARK.exec(rest); mark; mark = DEMO_MARK.exec(rest)) {
		const directive = directives[Number(mark[1])];
		const before = rest.slice(0, mark.index);
		const after = rest.slice(mark.index + mark[0].length);
		const end = after.search(/<h2 |<!--demo:/u);
		const more = end === -1 ? after : after.slice(0, end);
		if (directive) {
			blocks.push({ html: before });
			blocks.push({
				demo: {
					workstream: directive.workstream,
					height: directive.height,
					title: sectionTitle(before),
					lead: markdown.parseInline(directive.lead, { async: false }),
					tries: directive.tries.map((line) => markdown.parseInline(line, { async: false })),
					more,
					words: plain(more).split(/\s+/u).filter(Boolean).length,
				},
			});
		}
		rest = end === -1 ? '' : after.slice(end);
	}
	blocks.push({ html: rest });
	return {
		blocks: blocks.filter((block) => !('html' in block) || block.html.trim()),
		headings: rendered.headings,
	};
}

export function asMarkdownDocument(page: DocPage): string {
	return `# ${page.title}\n\n${page.description ? `> ${page.description}\n\n` : ''}${withoutDemos(page.markdown)}\n`;
}

export function llmsText(): string {
	const links = pages.map(
		(page) =>
			`- [${page.title}](${SITE_URL}${page.path}.md)${page.description ? `: ${page.description}` : ''}`,
	);
	return `# Malini\n\n> ${SITE_DESCRIPTION}\n\nEvery page below is plain markdown. [llms-full.txt](${SITE_URL}/llms-full.txt) holds all of them in one file.\n\n## Docs\n\n${links.join('\n')}\n`;
}
