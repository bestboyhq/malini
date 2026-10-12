import { FAMILIES, type Family, type FamilyLanguage } from './code-grammars.js';

export type TokenKind =
	| 'plain'
	| 'keyword'
	| 'string'
	| 'comment'
	| 'number'
	| 'type'
	| 'function'
	| 'punctuation'
	| 'attr'
	| 'added'
	| 'removed';

export type CodeToken = { text: string; kind: TokenKind };

export type SupportedLanguage = FamilyLanguage | 'diff' | 'markup' | 'text';

export type DiffLineSide = 'old' | 'new' | 'both';

const LANGUAGE_ALIASES: Readonly<Record<string, SupportedLanguage>> = {
	ts: 'typescript',
	tsx: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	typescript: 'typescript',
	js: 'typescript',
	jsx: 'typescript',
	mjs: 'typescript',
	cjs: 'typescript',
	javascript: 'typescript',
	node: 'typescript',
	rs: 'rust',
	rust: 'rust',
	py: 'python',
	pyi: 'python',
	pyw: 'python',
	python: 'python',
	python3: 'python',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	fish: 'shell',
	ksh: 'shell',
	shell: 'shell',
	console: 'shell',
	shellsession: 'shell',
	ps1: 'shell',
	psm1: 'shell',
	powershell: 'shell',
	bat: 'shell',
	cmd: 'shell',
	json: 'json',
	jsonc: 'json',
	json5: 'json',
	jsonl: 'json',
	ndjson: 'json',
	webmanifest: 'json',
	geojson: 'json',
	diff: 'diff',
	patch: 'diff',
	go: 'go',
	golang: 'go',
	sql: 'sql',
	psql: 'sql',
	pgsql: 'sql',
	plsql: 'sql',
	mysql: 'sql',
	sqlite: 'sql',
	postgres: 'sql',
	postgresql: 'sql',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	css: 'css',
	scss: 'css',
	sass: 'css',
	less: 'css',
	pcss: 'css',
	postcss: 'css',
	styl: 'css',
	html: 'markup',
	htm: 'markup',
	xhtml: 'markup',
	xml: 'markup',
	svg: 'markup',
	vue: 'markup',
	svelte: 'markup',
	astro: 'markup',
	erb: 'markup',
	ejs: 'markup',
	hbs: 'markup',
	handlebars: 'markup',
	xsl: 'markup',
	xslt: 'markup',
	xsd: 'markup',
	plist: 'markup',
	xaml: 'markup',
	csproj: 'markup',
	fsproj: 'markup',
	props: 'markup',
	targets: 'markup',
	markup: 'markup',
	md: 'markdown',
	mdx: 'markdown',
	markdown: 'markdown',
	c: 'c',
	h: 'c',
	cpp: 'c',
	cc: 'c',
	cxx: 'c',
	'c++': 'c',
	hpp: 'c',
	hh: 'c',
	hxx: 'c',
	ino: 'c',
	m: 'c',
	mm: 'c',
	objc: 'c',
	'objective-c': 'c',
	cu: 'c',
	cuh: 'c',
	metal: 'c',
	glsl: 'c',
	hlsl: 'c',
	wgsl: 'c',
	cs: 'csharp',
	csx: 'csharp',
	csharp: 'csharp',
	'c#': 'csharp',
	java: 'java',
	groovy: 'java',
	gradle: 'java',
	scala: 'java',
	sc: 'java',
	dart: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	kotlin: 'kotlin',
	swift: 'swift',
	php: 'php',
	rb: 'ruby',
	ruby: 'ruby',
	rake: 'ruby',
	gemspec: 'ruby',
	ru: 'ruby',
	lua: 'lua',
	luau: 'lua',
	dockerfile: 'dockerfile',
	docker: 'dockerfile',
	containerfile: 'dockerfile',
	makefile: 'makefile',
	make: 'makefile',
	mk: 'makefile',
	mak: 'makefile',
	ini: 'ini',
	cfg: 'ini',
	conf: 'ini',
	env: 'ini',
	dotenv: 'ini',
	properties: 'ini',
	editorconfig: 'ini',
	gitconfig: 'ini',
	desktop: 'ini',
	service: 'ini',
	graphql: 'graphql',
	gql: 'graphql',
	generic: 'generic',
	text: 'text',
	txt: 'text',
	plain: 'text',
	plaintext: 'text',
	nohighlight: 'text',
	log: 'text',
	logs: 'text',
	output: 'text',
	stdout: 'text',
	stderr: 'text',
};

const FILE_NAME_LANGUAGES: Readonly<Record<string, SupportedLanguage>> = {
	makefile: 'makefile',
	gnumakefile: 'makefile',
	justfile: 'makefile',
	gemfile: 'ruby',
	rakefile: 'ruby',
	podfile: 'ruby',
	vagrantfile: 'ruby',
	brewfile: 'ruby',
	fastfile: 'ruby',
	procfile: 'yaml',
	'yarn.lock': 'yaml',
	'cargo.lock': 'toml',
	'.bashrc': 'shell',
	'.bash_profile': 'shell',
	'.zshrc': 'shell',
	'.zprofile': 'shell',
	'.profile': 'shell',
	'.gitignore': 'ini',
	'.dockerignore': 'ini',
	'.npmignore': 'ini',
	'.prettierignore': 'ini',
	'.eslintignore': 'ini',
	'.gitattributes': 'ini',
	'.gitmodules': 'ini',
	'.npmrc': 'ini',
	'.yarnrc': 'ini',
	'.nvmrc': 'ini',
	'cmakelists.txt': 'generic',
};

const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, string | null>> = {
	typescript: 'TypeScript',
	rust: 'Rust',
	python: 'Python',
	shell: 'Shell',
	json: 'JSON',
	diff: 'Diff',
	go: 'Go',
	sql: 'SQL',
	yaml: 'YAML',
	toml: 'TOML',
	css: 'CSS',
	markup: 'HTML',
	markdown: 'Markdown',
	c: 'C',
	csharp: 'C#',
	java: 'Java',
	kotlin: 'Kotlin',
	swift: 'Swift',
	php: 'PHP',
	ruby: 'Ruby',
	lua: 'Lua',
	dockerfile: 'Dockerfile',
	makefile: 'Makefile',
	ini: 'INI',
	graphql: 'GraphQL',
	generic: null,
	text: null,
};

const BORROWED_GRAMMAR_LABELS: Readonly<Record<string, string>> = {
	js: 'JavaScript',
	jsx: 'JavaScript',
	mjs: 'JavaScript',
	cjs: 'JavaScript',
	javascript: 'JavaScript',
	node: 'JavaScript',
	scss: 'SCSS',
	sass: 'Sass',
	less: 'Less',
	xml: 'XML',
	svg: 'SVG',
	vue: 'Vue',
	svelte: 'Svelte',
	astro: 'Astro',
	mdx: 'MDX',
	cpp: 'C++',
	cc: 'C++',
	cxx: 'C++',
	'c++': 'C++',
	hpp: 'C++',
	m: 'Objective-C',
	mm: 'Objective-C',
	objc: 'Objective-C',
	'objective-c': 'Objective-C',
	cu: 'CUDA',
	glsl: 'GLSL',
	hlsl: 'HLSL',
	wgsl: 'WGSL',
	groovy: 'Groovy',
	gradle: 'Groovy',
	scala: 'Scala',
	dart: 'Dart',
	fish: 'Fish',
	ps1: 'PowerShell',
	powershell: 'PowerShell',
	bat: 'Batch',
	cmd: 'Batch',
	env: 'Env',
	dotenv: 'Env',
	properties: 'Properties',
};

function hintAlias(hint: string | null | undefined): string {
	if (!hint) return '';
	return (
		hint
			.trim()
			.toLowerCase()
			.split(/[\s:,]/u)[0] ?? ''
	).replace(/^(?:language-|\.)/u, '');
}

export function languageForPath(path: string): SupportedLanguage | null {
	const name = (path.split(/[\\/]/u).pop() ?? '').toLowerCase();
	const named = FILE_NAME_LANGUAGES[name];
	if (named) return named;
	if (name.startsWith('.env')) return 'ini';
	if (name.startsWith('dockerfile') || name.startsWith('containerfile')) return 'dockerfile';
	const dot = name.lastIndexOf('.');
	if (dot < 0) return null;
	return LANGUAGE_ALIASES[name.slice(dot + 1)] ?? null;
}

export function normalizeLanguage(hint: string | null | undefined): SupportedLanguage | null {
	const alias = hintAlias(hint);
	if (alias === '') return null;
	return LANGUAGE_ALIASES[alias] ?? (/[./]/u.test(alias) ? languageForPath(alias) : null);
}

export function resolveLanguage(
	hint: string | null | undefined,
	source: string,
): SupportedLanguage {
	const named = normalizeLanguage(hint);
	if (named) return named;
	if (hintAlias(hint) !== '') return 'generic';
	return detectLanguage(source) ?? (looksLikeCode(source) ? 'generic' : 'text');
}

export function languageLabel(language: SupportedLanguage | null): string | null {
	return language ? LANGUAGE_LABELS[language] : null;
}

export function languageHintLabel(hint: string | null | undefined): string | null {
	const alias = hintAlias(hint);
	return BORROWED_GRAMMAR_LABELS[alias] ?? languageLabel(LANGUAGE_ALIASES[alias] ?? null);
}

const GROUP_KINDS: readonly (readonly [string, TokenKind])[] = [
	['comment', 'comment'],
	['string', 'string'],
	['regex', 'string'],
	['number', 'number'],
	['attr', 'attr'],
	['flag', 'attr'],
	['keyword', 'keyword'],
	['type', 'type'],
	['lifetime', 'type'],
	['function', 'function'],
	['punct', 'punctuation'],
];

const CAPITALISED = /^[A-Z]/u;

function push(tokens: CodeToken[], kind: TokenKind, text: string): void {
	if (text.length === 0) return;
	const last = tokens[tokens.length - 1];
	if (last !== undefined && last.kind === kind) {
		last.text += text;
		return;
	}
	tokens.push({ text, kind });
}

function pushAll(tokens: CodeToken[], more: readonly CodeToken[]): void {
	for (const token of more) push(tokens, token.kind, token.text);
}

function classify(match: RegExpExecArray, family: Family, source: string): TokenKind {
	const groups = match.groups ?? {};
	for (const [name, kind] of GROUP_KINDS) {
		if (groups[name] !== undefined) return kind;
	}
	const word = groups.command ?? groups.ident;
	if (word === undefined) return 'plain';
	const lookup = family.foldCase ? word.toLowerCase() : word;
	if (family.keywords.has(lookup)) return 'keyword';
	if (family.types.has(lookup)) return 'type';
	if (source[match.index + match[0].length] === '(') return 'function';
	if (groups.command !== undefined) return 'function';
	if (family.capitalisedIsType === true && CAPITALISED.test(word)) return 'type';
	return 'plain';
}

function tokenizeFamily(source: string, family: Family): CodeToken[] {
	const tokens: CodeToken[] = [];
	const pattern = family.pattern;
	pattern.lastIndex = 0;
	let cursor = 0;
	let match = pattern.exec(source);
	while (match !== null) {
		if (match[0].length === 0) {
			pattern.lastIndex += 1;
		} else {
			push(tokens, 'plain', source.slice(cursor, match.index));
			push(tokens, classify(match, family, source), match[0]);
			cursor = match.index + match[0].length;
		}
		match = pattern.exec(source);
	}
	push(tokens, 'plain', source.slice(cursor));
	return tokens;
}

function diffLineKind(line: string): TokenKind {
	if (line.startsWith('@@')) return 'function';
	if (line.startsWith('+++') || line.startsWith('---')) return 'comment';
	if (line.startsWith('diff ') || line.startsWith('index ')) return 'comment';
	if (line.startsWith('+')) return 'added';
	if (line.startsWith('-')) return 'removed';
	return 'plain';
}

function tokenizeDiff(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	for (const line of source.split(/(?<=\n)/u)) push(tokens, diffLineKind(line), line);
	return tokens;
}

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)\n?$/u;

function isFenceClose(line: string, fence: string): boolean {
	const trimmed = line.trim();
	return trimmed.length >= fence.length && trimmed === (fence[0] ?? '').repeat(trimmed.length);
}

function tokenizeMarkdown(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	const lines = source.split(/(?<=\n)/u);
	let prose = '';
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		const open = FENCE_OPEN.exec(line);
		const fence = open?.[1];
		const info = open?.[2] ?? '';
		if (fence === undefined || (fence.startsWith('`') && info.includes('`'))) {
			prose += line;
			index += 1;
			continue;
		}
		pushAll(tokens, tokenizeFamily(prose, FAMILIES.markdown));
		prose = '';
		const marker = line.indexOf(fence) + fence.length;
		push(tokens, 'punctuation', line.slice(0, marker));
		push(tokens, 'attr', line.slice(marker));
		let close = index + 1;
		while (close < lines.length && !isFenceClose(lines[close] ?? '', fence)) close += 1;
		const body = lines.slice(index + 1, close).join('');
		const bodyText = body.endsWith('\n') ? body.slice(0, -1) : body;
		pushAll(tokens, highlightCode(bodyText, info));
		if (bodyText.length < body.length) push(tokens, 'plain', '\n');
		if (close < lines.length) push(tokens, 'punctuation', lines[close] ?? '');
		index = close + 1;
	}
	pushAll(tokens, tokenizeFamily(prose, FAMILIES.markdown));
	return tokens;
}

const SVELTE_BLOCK_MARKER = /^[#:/@][A-Za-z]+(?:[ \t]+if\b)?/u;
const EXPRESSION_ATTRIBUTE = /^(?::|@|#|v-|x-)/u;
const TAG_NAME = /^[A-Za-z][\w:.-]*/u;
const ATTRIBUTE_NAME = /^[^\s=>/{"'<]+/u;
const UNQUOTED_VALUE = /^[^\s>]+/u;

function quoteEnd(source: string, start: number): number {
	const quote = source[start];
	for (let index = start + 1; index < source.length; index += 1) {
		const character = source[index];
		if (character === '\\') index += 1;
		else if (character === quote) return index + 1;
	}
	return source.length;
}

const MAX_EXPRESSION_CHARACTERS = 10_000;

function expressionEnd(source: string, start: number): number | null {
	let depth = 0;
	const limit = Math.min(source.length, start + MAX_EXPRESSION_CHARACTERS);
	for (let index = start; index < limit; index += 1) {
		const character = source[index];
		if (character === '"' || character === "'" || character === '`') {
			index = quoteEnd(source, index) - 1;
		} else if (character === '{') {
			depth += 1;
		} else if (character === '}') {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
	}
	return null;
}

function pushExpression(tokens: CodeToken[], source: string, start: number): number {
	const end = expressionEnd(source, start);
	if (end === null) {
		push(tokens, 'plain', '{');
		return start + 1;
	}
	const inner = source.slice(start + 1, end - 1);
	push(tokens, 'punctuation', '{');
	const marker = SVELTE_BLOCK_MARKER.exec(inner)?.[0] ?? '';
	push(tokens, 'keyword', marker);
	pushAll(tokens, tokenizeFamily(inner.slice(marker.length), FAMILIES.typescript));
	push(tokens, 'punctuation', '}');
	return end;
}

function pushQuotedValue(
	tokens: CodeToken[],
	source: string,
	start: number,
	expression: boolean,
): number {
	const end = quoteEnd(source, start);
	const quote = source[start] ?? '"';
	const closed = end - start > 1 && source[end - 1] === quote;
	const inner = source.slice(start + 1, closed ? end - 1 : end);
	push(tokens, 'string', quote);
	if (expression) {
		pushAll(tokens, tokenizeFamily(inner, FAMILIES.typescript));
	} else {
		let cursor = 0;
		for (let brace = inner.indexOf('{'); brace >= 0; brace = inner.indexOf('{', cursor)) {
			push(tokens, 'string', inner.slice(cursor, brace));
			cursor = pushExpression(tokens, inner, brace);
		}
		push(tokens, 'string', inner.slice(cursor));
	}
	if (closed) push(tokens, 'string', quote);
	return end;
}

type TagAttributes = Map<string, string>;

function pushTag(tokens: CodeToken[], source: string, start: number): [number, TagAttributes] {
	const attributes: TagAttributes = new Map();
	const closing = source.startsWith('</', start);
	const opener = closing ? '</' : '<';
	const name = TAG_NAME.exec(source.slice(start + opener.length, start + 256))?.[0] ?? '';
	push(tokens, 'punctuation', opener);
	push(tokens, 'keyword', name);
	let cursor = start + opener.length + name.length;
	while (cursor < source.length) {
		const character = source[cursor] ?? '';
		if (character === '>') {
			push(tokens, 'punctuation', '>');
			return [cursor + 1, attributes];
		}
		if (source.startsWith('/>', cursor)) {
			push(tokens, 'punctuation', '/>');
			attributes.set('/', '');
			return [cursor + 2, attributes];
		}
		if (/\s/u.test(character)) {
			const space = /^\s+/u.exec(source.slice(cursor, cursor + 256))?.[0] ?? character;
			push(tokens, 'plain', space);
			cursor += space.length;
			continue;
		}
		if (character === '{') {
			cursor = pushExpression(tokens, source, cursor);
			continue;
		}
		const attribute = ATTRIBUTE_NAME.exec(source.slice(cursor, cursor + 256))?.[0];
		if (!attribute) {
			push(tokens, 'punctuation', character);
			cursor += 1;
			continue;
		}
		push(tokens, 'attr', attribute);
		cursor += attribute.length;
		if (source[cursor] !== '=') {
			attributes.set(attribute.toLowerCase(), '');
			continue;
		}
		push(tokens, 'punctuation', '=');
		cursor += 1;
		const value = source[cursor];
		const valueStart = cursor;
		if (value === '"' || value === "'") {
			cursor = pushQuotedValue(tokens, source, cursor, EXPRESSION_ATTRIBUTE.test(attribute));
		} else if (value === '{') {
			cursor = pushExpression(tokens, source, cursor);
		} else {
			const bare = UNQUOTED_VALUE.exec(source.slice(cursor, cursor + 1024))?.[0] ?? '';
			push(tokens, 'string', bare);
			cursor += bare.length;
		}
		attributes.set(
			attribute.toLowerCase(),
			source.slice(valueStart, cursor).replace(/^["']|["']$/gu, ''),
		);
	}
	return [cursor, attributes];
}

function embeddedLanguage(tag: string, attributes: TagAttributes): SupportedLanguage | null {
	if (attributes.has('/')) return null;
	if (tag === 'style') return 'css';
	if (tag !== 'script') return null;
	const type = attributes.get('type') ?? '';
	if (/json|importmap/u.test(type)) return 'json';
	if (/html|template/u.test(type)) return 'markup';
	return 'typescript';
}

function pushRawElement(
	tokens: CodeToken[],
	source: string,
	start: number,
	tag: string,
	language: SupportedLanguage,
): number {
	const closing = new RegExp(`</${tag}[\\s>]`, 'giu');
	closing.lastIndex = start;
	const end = closing.exec(source)?.index ?? source.length;
	pushAll(tokens, tokenize(source.slice(start, end), language));
	return end;
}

function pushProcessingInstruction(tokens: CodeToken[], source: string, start: number): number {
	const close = source.indexOf('?>', start + 2);
	const end = close < 0 ? source.length : close;
	const opener =
		/^<\?(?:php|=|[A-Za-z][\w-]*)?/u.exec(source.slice(start, start + 16))?.[0] ?? '<?';
	push(tokens, 'keyword', opener);
	const body = source.slice(start + opener.length, end);
	pushAll(
		tokens,
		tokenizeFamily(body, opener === '<?php' || opener === '<?=' ? FAMILIES.php : FAMILIES.generic),
	);
	if (close >= 0) push(tokens, 'keyword', '?>');
	return close < 0 ? end : close + 2;
}

function pushDeclaration(tokens: CodeToken[], source: string, start: number): number {
	if (source.startsWith('<!--', start)) {
		const close = source.indexOf('-->', start + 4);
		const end = close < 0 ? source.length : close + 3;
		push(tokens, 'comment', source.slice(start, end));
		return end;
	}
	if (source.startsWith('<![CDATA[', start)) {
		const close = source.indexOf(']]>', start);
		const end = close < 0 ? source.length : close + 3;
		push(tokens, 'string', source.slice(start, end));
		return end;
	}
	const close = source.indexOf('>', start);
	const end = close < 0 ? source.length : close + 1;
	const name = /^<![A-Za-z]+/u.exec(source.slice(start, end))?.[0] ?? '<!';
	push(tokens, 'punctuation', '<!');
	push(tokens, 'keyword', name.slice(2));
	push(tokens, 'plain', source.slice(start + name.length, close < 0 ? end : close));
	if (close >= 0) push(tokens, 'punctuation', '>');
	return end;
}

function tokenizeMarkup(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	let cursor = 0;
	let text = 0;
	while (cursor < source.length) {
		const character = source[cursor];
		if (character !== '<' && character !== '{') {
			cursor += 1;
			continue;
		}
		push(tokens, 'plain', source.slice(text, cursor));
		if (character === '{') {
			cursor = pushExpression(tokens, source, cursor);
		} else if (source.startsWith('<!', cursor)) {
			cursor = pushDeclaration(tokens, source, cursor);
		} else if (source.startsWith('<?', cursor)) {
			cursor = pushProcessingInstruction(tokens, source, cursor);
		} else if (
			TAG_NAME.test(source.slice(cursor + 1, cursor + 2)) ||
			source.startsWith('</', cursor)
		) {
			const closing = source.startsWith('</', cursor);
			const [end, attributes] = pushTag(tokens, source, cursor);
			const tagStart = cursor + (closing ? 2 : 1);
			const tag = (TAG_NAME.exec(source.slice(tagStart, tagStart + 256))?.[0] ?? '').toLowerCase();
			const language = closing ? null : embeddedLanguage(tag, attributes);
			cursor = language ? pushRawElement(tokens, source, end, tag, language) : end;
		} else {
			push(tokens, 'plain', '<');
			cursor += 1;
		}
		text = cursor;
	}
	push(tokens, 'plain', source.slice(text));
	return tokens;
}

function tokenize(source: string, language: SupportedLanguage): CodeToken[] {
	if (source.length === 0) return [];
	switch (language) {
		case 'text':
			return [{ text: source, kind: 'plain' }];
		case 'diff':
			return tokenizeDiff(source);
		case 'markup':
			return tokenizeMarkup(source);
		case 'markdown':
			return tokenizeMarkdown(source);
		case 'php':
			return /<\?(?:php|=)/u.test(source)
				? tokenizeMarkup(source)
				: tokenizeFamily(source, FAMILIES.php);
		default:
			return tokenizeFamily(source, FAMILIES[language]);
	}
}

export function highlightCode(source: string, language: string | null | undefined): CodeToken[] {
	if (source.length === 0) return [];
	return tokenize(source, resolveLanguage(language, source));
}

function splitLines(tokens: readonly CodeToken[]): CodeToken[][] {
	const lines: CodeToken[][] = [[]];
	for (const token of tokens) {
		const parts = token.text.split('\n');
		for (const [index, part] of parts.entries()) {
			if (index > 0) lines.push([]);
			if (part.length > 0) lines[lines.length - 1]?.push({ kind: token.kind, text: part });
		}
	}
	return lines;
}

export function highlightCodeLines(
	source: string,
	language: string | null | undefined,
): CodeToken[][] {
	return splitLines(highlightCode(source, language));
}

export function highlightDiffLines(
	lines: readonly Readonly<{ text: string; side: DiffLineSide }>[],
	language: string | null | undefined,
): (readonly CodeToken[])[] {
	const oldSide = lines.filter(({ side }) => side !== 'new').map(({ text }) => text);
	const newSide = lines.filter(({ side }) => side !== 'old').map(({ text }) => text);
	const sample = newSide.length > 0 ? newSide.join('\n') : oldSide.join('\n');
	const resolved = resolveLanguage(language, sample);
	const oldTokens = splitLines(tokenize(oldSide.join('\n'), resolved));
	const newTokens = splitLines(tokenize(newSide.join('\n'), resolved));
	let oldIndex = 0;
	let newIndex = 0;
	return lines.map(({ side }) => {
		if (side === 'old') return oldTokens[oldIndex++] ?? [];
		if (side === 'both') oldIndex += 1;
		return newTokens[newIndex++] ?? [];
	});
}

const DIFF_SHAPE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|^--- .*\n\+\+\+ |^diff --git /mu;
const SHELL_COMMANDS =
	/^[ \t]*[$>]?[ \t]*(?:git|npm|npx|pnpm|yarn|bun|cargo|node|deno|python3?|pip3?|uv|cd|ls|mkdir|rm|cp|mv|cat|echo|curl|wget|grep|rg|sed|awk|make|docker|kubectl|brew|sudo|chmod|find|tar|ssh|bash|sh|zsh|pytest|go|swift|tsc|eslint|prettier|vitest|playwright|xcodebuild)\b/u;
const RUST_SHAPE = /^[ \t]*(?:pub[ \t]+)?(?:fn|impl|struct|enum|trait|mod|use)[ \t]/mu;
const PYTHON_SHAPE =
	/^[ \t]*(?:def|class)[ \t]+\w+[^\n]*:[ \t]*$|^(?:from[ \t]+[\w.]+[ \t]+)?import[ \t]+[\w.,* ]+$/mu;
const TYPESCRIPT_SHAPE =
	/^[ \t]*(?:export[ \t]+)?(?:const|let|var|function|class|interface|type|enum|async[ \t]+function)\b|^[ \t]*import[ \t]+[{*][^\n]*from\b/mu;
const SQL_SHAPE =
	/^[ \t]*(?:select|insert[ \t]+into|update|delete[ \t]+from|create[ \t]+(?:table|index|view)|alter[ \t]+table|with)\b/imu;
const C_SHAPE =
	/^[ \t]*#[ \t]*(?:include|define|pragma|ifndef)\b|^[ \t]*(?:int|void)[ \t]+main[ \t]*\(/mu;
const CSHARP_SHAPE = /^[ \t]*using[ \t]+System\b|^[ \t]*namespace[ \t]+[\w.]+[ \t]*[;{]?[ \t]*$/mu;
const JAVA_SHAPE =
	/^[ \t]*package[ \t]+[\w.]+;|^[ \t]*(?:public|private|protected)[ \t]+(?:static[ \t]+|final[ \t]+|abstract[ \t]+)*(?:class|interface|enum|record|void)\b/mu;
const KOTLIN_SHAPE = /^[ \t]*(?:fun|val|data[ \t]+class|object)[ \t]+\w/mu;
const SWIFT_SHAPE =
	/^[ \t]*import[ \t]+(?:Foundation|UIKit|SwiftUI|AppKit)\b|\bfunc[ \t]+\w+[^\n]*->/mu;
const RUBY_SHAPE = /^[ \t]*(?:def|class|module)[ \t]+[\w:.]+[^:\n]*$/mu;
const BLOCK_END = /^[ \t]*end\b/mu;
const YAML_SHAPE = /^[ \t]*(?:-[ \t]+)?[\w.-]+:(?:[ \t]+\S[^\n]*)?$/mu;
const CSS_RULE = /^[ \t]*[.#:@]?[\w-][^{}\n;]*\{[ \t]*$/mu;
const CSS_DECLARATION = /^[ \t]*[\w-]+[ \t]*:[^;\n]*;/mu;
const INI_SECTION = /^[ \t]*\[[^\]\n]+\][ \t]*$/mu;
const INI_ENTRY = /^[ \t]*[\w.-]+[ \t]*=/mu;
const GRAPHQL_SHAPE = /^[ \t]*(?:query|mutation|subscription|fragment)\b[^\n]*\{/mu;
const LUA_SHAPE = /^[ \t]*local[ \t]+(?:function[ \t]+)?\w+/mu;
const CODE_SIGNAL =
	/[{};]|[=!<>]=|=>|->|::|\w\(|^\s*(?:\/\/|#!|<\/?[A-Za-z]|@[A-Za-z]|\$ )|^\s*[\w.-]+\s*=\s*\S/u;

function isJsonDocument(source: string): boolean {
	const trimmed = source.trim();
	if (!/^[[{]/u.test(trimmed) || !/[\]}]$/u.test(trimmed)) return false;
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

function looksLikeCode(source: string): boolean {
	const lines = source
		.slice(0, 4_000)
		.split('\n')
		.filter((line) => line.trim().length > 0);
	if (lines.length === 0) return false;
	const signals = lines.filter((line) => CODE_SIGNAL.test(line)).length;
	return signals / lines.length >= 0.3;
}

function detectLanguageUncached(source: string): SupportedLanguage | null {
	if (source.length === 0) return null;
	const head = source.slice(0, 4_000);
	const opening =
		head.split('\n').find((line) => line.trim().length > 0 && !line.trimStart().startsWith('#')) ??
		'';
	if (DIFF_SHAPE.test(head)) return 'diff';
	if (/^<\?php\b/u.test(head.trimStart())) return 'php';
	if (/^#!.*\b(?:bash|sh|zsh)\b/u.test(head) || SHELL_COMMANDS.test(opening)) return 'shell';
	if (/^#!.*\bpython/u.test(head)) return 'python';
	if (/^#!.*\b(?:node|deno|bun)\b/u.test(head)) return 'typescript';
	if (/^[ \t]*FROM[ \t]+\S+/u.test(opening)) return 'dockerfile';
	if (RUST_SHAPE.test(head) && /(?:->|\blet\s|::)/u.test(head)) return 'rust';
	if (/^package[ \t]+\w+[ \t]*$/mu.test(head) || (/\bfunc\s/u.test(head) && /:=/u.test(head)))
		return 'go';
	if (C_SHAPE.test(head)) return 'c';
	if (CSHARP_SHAPE.test(head)) return 'csharp';
	if (JAVA_SHAPE.test(head)) return 'java';
	if (SWIFT_SHAPE.test(head)) return 'swift';
	if (PYTHON_SHAPE.test(head)) return 'python';
	if (TYPESCRIPT_SHAPE.test(head)) return 'typescript';
	if (KOTLIN_SHAPE.test(head)) return 'kotlin';
	if (RUBY_SHAPE.test(head) && BLOCK_END.test(head)) return 'ruby';
	if (LUA_SHAPE.test(head) && BLOCK_END.test(head)) return 'lua';
	if (SQL_SHAPE.test(head) && /\b(?:from|into|set|values|table)\b/iu.test(head)) return 'sql';
	if (GRAPHQL_SHAPE.test(head)) return 'graphql';
	if (isJsonDocument(source)) return 'json';
	if (/^[ \t]*<[!A-Za-z]/u.test(head) && /<\/[A-Za-z][\w:.-]*>/u.test(head)) return 'markup';
	if (CSS_RULE.test(head) && CSS_DECLARATION.test(head)) return 'css';
	if (INI_SECTION.test(head) && INI_ENTRY.test(head)) return 'ini';
	if (isYamlDocument(head)) return 'yaml';
	return null;
}

function isYamlDocument(head: string): boolean {
	const lines = head
		.split('\n')
		.filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));
	if (lines.length < 2) return false;
	const mapped = lines.filter((line) => YAML_SHAPE.test(line) || /^[ \t]*-[ \t]+\S/u.test(line));
	return (
		mapped.length / lines.length >= 0.8 && !lines.some((line) => /[;{]$|^\}/u.test(line.trim()))
	);
}

const DETECTION_MEMO_LIMIT = 64;
const detectionMemo = new Map<string, SupportedLanguage | null>();

export function detectLanguage(source: string): SupportedLanguage | null {
	const memoized = detectionMemo.get(source);
	if (memoized !== undefined || detectionMemo.has(source)) return memoized ?? null;
	const detected = detectLanguageUncached(source);
	if (detectionMemo.size >= DETECTION_MEMO_LIMIT) {
		const oldest = detectionMemo.keys().next().value;
		if (oldest !== undefined) detectionMemo.delete(oldest);
	}
	detectionMemo.set(source, detected);
	return detected;
}
