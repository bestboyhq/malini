import { canonicalChangedPath } from './run-timeline';

export type FileMentionTarget = {
	readonly path: string;
	readonly line: number | null;
};

export const FILE_MENTION_PATH_ATTRIBUTE = 'data-file-path';
export const FILE_MENTION_LINE_ATTRIBUTE = 'data-file-line';
const FILE_MENTION_MISSING_ATTRIBUTE = 'data-file-missing';

const MAX_MENTION_LENGTH = 240;

const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
	'astro',
	'avif',
	'bash',
	'bat',
	'c',
	'cc',
	'cfg',
	'cjs',
	'clj',
	'conf',
	'cpp',
	'cs',
	'css',
	'csv',
	'cts',
	'dart',
	'diff',
	'ex',
	'exs',
	'fish',
	'gif',
	'go',
	'gql',
	'gradle',
	'graphql',
	'h',
	'hbs',
	'hpp',
	'hs',
	'html',
	'ico',
	'ini',
	'java',
	'jl',
	'jpeg',
	'jpg',
	'js',
	'json',
	'json5',
	'jsonc',
	'jsx',
	'kt',
	'kts',
	'less',
	'lock',
	'lua',
	'md',
	'mdx',
	'mjs',
	'mts',
	'patch',
	'pdf',
	'php',
	'plist',
	'png',
	'properties',
	'proto',
	'ps1',
	'py',
	'pyi',
	'rb',
	'rs',
	'sass',
	'scala',
	'scss',
	'sh',
	'snap',
	'sol',
	'sql',
	'styl',
	'svelte',
	'svg',
	'swift',
	'tf',
	'toml',
	'ts',
	'tsv',
	'tsx',
	'txt',
	'vue',
	'wasm',
	'webp',
	'xml',
	'yaml',
	'yml',
	'zip',
	'zsh',
]);

const EXTENSIONLESS_FILE_NAMES: ReadonlySet<string> = new Set([
	'.babelrc',
	'.browserslistrc',
	'.dockerignore',
	'.editorconfig',
	'.env',
	'.eslintrc',
	'.gitattributes',
	'.gitignore',
	'.gitmodules',
	'.npmrc',
	'.nvmrc',
	'.prettierrc',
	'Brewfile',
	'CODEOWNERS',
	'Dockerfile',
	'Gemfile',
	'LICENSE',
	'Makefile',
	'Procfile',
	'Rakefile',
]);

const LINE_SUFFIX = /:(\d{1,7})(?::\d{1,7})?$/u;

const PATH_SHAPE = /^\/?[A-Za-z0-9._~@+-]+(?:\/[A-Za-z0-9._~@+-]+)*$/u;
const RELATIVE_PREFIX = /^\.{1,2}\//u;
const WEB_HOST_PREFIX = /^www\./iu;
const LEADING_NOISE = /^[([{<"'`«]+/u;
const TRAILING_NOISE = /[)\]}>"'`»,;:.!?]+$/u;
const NON_WHITESPACE_RUN = /\S+/gu;

const SKIPPED_ANCESTORS = 'a, code, pre, script, style';

function hasRealFileExtension(basename: string): boolean {
	const dot = basename.lastIndexOf('.');
	if (dot <= 0) return false;
	if (!/[^.]/u.test(basename.slice(0, dot))) return false;
	return FILE_EXTENSIONS.has(basename.slice(dot + 1).toLowerCase());
}

function isPathShaped(path: string, requireSlash: boolean): boolean {
	if (requireSlash && !path.includes('/')) return false;
	if (!PATH_SHAPE.test(path)) return false;
	const separator = path.lastIndexOf('/');
	const basename = path.slice(separator + 1);
	if (basename === '.' || basename === '..') return false;
	if (
		path
			.slice(0, Math.max(0, separator))
			.split('/')
			.some((segment) => hasRealFileExtension(segment))
	) {
		return false;
	}
	if (RELATIVE_PREFIX.test(path)) return true;
	return hasRealFileExtension(basename) || EXTENSIONLESS_FILE_NAMES.has(basename);
}

export function parseFileMention(
	value: string,
	options: { readonly requireSlash: boolean },
): FileMentionTarget | null {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_MENTION_LENGTH) return null;
	if (WEB_HOST_PREFIX.test(trimmed)) return null;

	const suffix = LINE_SUFFIX.exec(trimmed);
	const rawPath = suffix ? trimmed.slice(0, suffix.index) : trimmed;
	if (!isPathShaped(rawPath, options.requireSlash)) return null;

	const path = canonicalChangedPath(rawPath);
	if (path.length === 0) return null;

	const line = suffix ? Number.parseInt(suffix[1] ?? '', 10) : Number.NaN;
	return { path, line: Number.isSafeInteger(line) && line > 0 ? line : null };
}

export function readFileMentionTarget(element: Element): FileMentionTarget | null {
	if (element.hasAttribute(FILE_MENTION_MISSING_ATTRIBUTE)) return null;
	return mentionedTarget(element);
}

export function markOpenableFileMentions(
	root: ParentNode,
	canOpen: ((path: string) => boolean) | undefined,
): void {
	for (const anchor of root.querySelectorAll(`a[${FILE_MENTION_PATH_ATTRIBUTE}]`)) {
		const target = mentionedTarget(anchor);
		if (!target) continue;
		const openable = canOpen?.(target.path) ?? true;
		if (openable !== anchor.hasAttribute(FILE_MENTION_MISSING_ATTRIBUTE)) continue;
		if (openable) linkFileMention(anchor, target);
		else unlinkFileMention(anchor);
	}
}

function mentionedTarget(element: Element): FileMentionTarget | null {
	const path = element.getAttribute(FILE_MENTION_PATH_ATTRIBUTE);
	if (!path) return null;
	const rawLine = element.getAttribute(FILE_MENTION_LINE_ATTRIBUTE);
	const line = rawLine === null ? Number.NaN : Number.parseInt(rawLine, 10);
	return { path, line: Number.isSafeInteger(line) && line > 0 ? line : null };
}

function createFileMentionAnchor(target: FileMentionTarget): HTMLAnchorElement {
	const anchor = document.createElement('a');
	anchor.setAttribute(FILE_MENTION_PATH_ATTRIBUTE, target.path);
	if (target.line !== null) {
		anchor.setAttribute(FILE_MENTION_LINE_ATTRIBUTE, String(target.line));
	}
	linkFileMention(anchor, target);
	return anchor;
}

function linkFileMention(anchor: Element, target: FileMentionTarget): void {
	anchor.removeAttribute(FILE_MENTION_MISSING_ATTRIBUTE);
	anchor.setAttribute('role', 'link');
	anchor.setAttribute('tabindex', '0');
	anchor.setAttribute(
		'aria-label',
		target.line === null ? `Open ${target.path}` : `Open ${target.path} at line ${target.line}`,
	);
	anchor.setAttribute('data-testid', 'markdown-file-link');
}

function unlinkFileMention(anchor: Element): void {
	anchor.setAttribute(FILE_MENTION_MISSING_ATTRIBUTE, '');
	for (const name of ['role', 'tabindex', 'aria-label', 'data-testid'])
		anchor.removeAttribute(name);
}

function linkifyCodeSpans(root: DocumentFragment): boolean {
	let rewrote = false;
	for (const element of root.querySelectorAll('code')) {
		if (element.closest('pre') || element.closest('a')) continue;
		const target = parseFileMention(element.textContent ?? '', { requireSlash: false });
		if (!target) continue;
		const anchor = createFileMentionAnchor(target);
		element.replaceWith(anchor);
		anchor.append(element);
		rewrote = true;
	}
	return rewrote;
}

function linkifyTextNode(node: Text): boolean {
	const data = node.data;
	if (!data.includes('/')) return false;

	const fragment = document.createDocumentFragment();
	let cursor = 0;
	for (const match of data.matchAll(NON_WHITESPACE_RUN)) {
		const token = match[0];
		const tokenStart = match.index ?? 0;
		const leading = LEADING_NOISE.exec(token)?.[0].length ?? 0;
		const candidate = token.slice(leading).replace(TRAILING_NOISE, '');
		if (candidate.length === 0) continue;
		const target = parseFileMention(candidate, { requireSlash: true });
		if (target === null) continue;

		const start = tokenStart + leading;
		if (start > cursor) fragment.append(data.slice(cursor, start));
		const anchor = createFileMentionAnchor(target);
		anchor.textContent = candidate;
		fragment.append(anchor);
		cursor = start + candidate.length;
	}

	if (cursor === 0) return false;
	if (cursor < data.length) fragment.append(data.slice(cursor));
	node.replaceWith(fragment);
	return true;
}

function linkifyProse(root: DocumentFragment): boolean {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!(node instanceof Text) || node.data.length === 0) continue;
		if (node.parentElement?.closest(SKIPPED_ANCESTORS)) continue;
		nodes.push(node);
	}

	let rewrote = false;
	for (const node of nodes) {
		if (linkifyTextNode(node)) rewrote = true;
	}
	return rewrote;
}

export function linkifyFileMentions(sanitizedHtml: string): string {
	if (typeof document === 'undefined' || sanitizedHtml.length === 0) return sanitizedHtml;

	const template = document.createElement('template');
	template.innerHTML = sanitizedHtml;
	const rewroteCodeSpans = linkifyCodeSpans(template.content);
	const rewroteProse = linkifyProse(template.content);
	return rewroteCodeSpans || rewroteProse ? template.innerHTML : sanitizedHtml;
}
