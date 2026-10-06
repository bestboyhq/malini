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

export type SupportedLanguage =
	| 'typescript'
	| 'rust'
	| 'python'
	| 'shell'
	| 'json'
	| 'diff'
	| 'go'
	| 'sql'
	| 'yaml'
	| 'toml'
	| 'css'
	| 'markup'
	| 'markdown';

export const MAX_HIGHLIGHT_CHARACTERS = 100_000;

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
	python: 'python',
	python3: 'python',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	shell: 'shell',
	console: 'shell',
	json: 'json',
	jsonc: 'json',
	json5: 'json',
	diff: 'diff',
	patch: 'diff',
	go: 'go',
	golang: 'go',
	sql: 'sql',
	postgres: 'sql',
	postgresql: 'sql',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	css: 'css',
	scss: 'css',
	less: 'css',
	html: 'markup',
	xml: 'markup',
	svg: 'markup',
	vue: 'markup',
	svelte: 'markup',
	md: 'markdown',
	markdown: 'markdown',
};

const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, string>> = {
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
};

const BORROWED_GRAMMAR_LABELS: Readonly<Record<string, string>> = {
	js: 'JavaScript',
	jsx: 'JavaScript',
	mjs: 'JavaScript',
	cjs: 'JavaScript',
	javascript: 'JavaScript',
	node: 'JavaScript',
	scss: 'SCSS',
	less: 'Less',
	xml: 'XML',
	svg: 'SVG',
	vue: 'Vue',
	svelte: 'Svelte',
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

export function normalizeLanguage(hint: string | null | undefined): SupportedLanguage | null {
	return LANGUAGE_ALIASES[hintAlias(hint)] ?? null;
}

export function languageLabel(language: SupportedLanguage | null): string | null {
	return language ? LANGUAGE_LABELS[language] : null;
}

export function languageHintLabel(hint: string | null | undefined): string | null {
	const alias = hintAlias(hint);
	return BORROWED_GRAMMAR_LABELS[alias] ?? languageLabel(LANGUAGE_ALIASES[alias] ?? null);
}

function wordSet(words: string): ReadonlySet<string> {
	return new Set(words.split(' '));
}

const NO_WORDS: ReadonlySet<string> = new Set();

type Family = {
	pattern: RegExp;
	keywords: ReadonlySet<string>;
	types: ReadonlySet<string>;
	foldCase?: boolean;
	capitalisedIsType?: boolean;
};

const FAMILIES: Readonly<Record<Exclude<SupportedLanguage, 'diff' | 'markup'>, Family>> = {
	typescript: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(?<number>\b0[xXbBoO][\da-fA-F_]+n?\b|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?\b)|(?<attr>@[A-Za-z_$][\w$]*)|(?<ident>[A-Za-z_$][\w$]*)|(?<punct>[{}()[\].,;:?!<>=+\-*\/%&|^~]+)/g,
		keywords: wordSet(
			'const let var function class extends implements interface type enum return if else for while do switch case default break continue new delete typeof instanceof in of this super import export from as async await yield try catch finally throw static get set public private protected readonly abstract declare namespace module satisfies keyof infer is void null undefined true false',
		),
		types: wordSet(
			'string number boolean any unknown never object symbol bigint Promise Array Record Map Set Partial Required Readonly Pick Omit',
		),
		capitalisedIsType: true,
	},
	rust: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>r#*"[\s\S]*?"#*|b?"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])')|(?<attr>#!?\[[^\]\n]*\]?)|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[iuf](?:8|16|32|64|128|size))?\b)|(?<lifetime>'[A-Za-z_]\w*)|(?<ident>[A-Za-z_]\w*!?)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'fn let mut const static struct enum trait impl for while loop match if else return break continue use mod pub crate self Self super where as in ref move dyn unsafe async await type extern box true false',
		),
		types: wordSet(
			'u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap HashSet',
		),
		capitalisedIsType: true,
	},
	python: {
		pattern:
			/(?<comment>#[^\n]*)|(?<string>[rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|"""[\s\S]*|'''[\s\S]*?'''|'''[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?))|(?<attr>@[A-Za-z_][\w.]*)|(?<number>\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?[jJ]?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'def class return if elif else for while break continue pass import from as with try except finally raise lambda yield global nonlocal assert del in is not and or None True False async await match case self',
		),
		types: wordSet('int float str bool list dict set tuple bytes object type complex frozenset'),
		capitalisedIsType: true,
	},
	shell: {
		pattern:
			/(?<comment>(?<=^|\s)#[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?)|(?<attr>\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[@*#?$!\d-])|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<number>\b\d+\b)|(?<command>(?<=^[ \t]*|[|;&(][ \t]*)[A-Za-z_][\w.\/-]*)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/gm,
		keywords: wordSet(
			'if then else elif fi for while until do done case esac in function return break continue local export readonly declare set unset source exit trap shift eval exec',
		),
		types: NO_WORDS,
	},
	json: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<attr>"(?:\\[\s\S]|[^"\\])*"(?=[ \t]*:))|(?<string>"(?:\\[\s\S]|[^"\\])*"?)|(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<ident>\b(?:true|false|null)\b)|(?<punct>[{}[\],:])/g,
		keywords: wordSet('true false null'),
		types: NO_WORDS,
	},
	go: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|`[^`]*`?|'(?:\\[\s\S]|[^'\\])')|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'package import func var const type struct interface map chan go defer return if else for range switch case default break continue select fallthrough goto',
		),
		types: wordSet(
			'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune error any nil true false iota',
		),
	},
	sql: {
		pattern:
			/(?<comment>--[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>'(?:''|[^'])*'?|"[^"]*"?)|(?<number>\b\d+(?:\.\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[(),.;*=<>+\-\/|]+)/g,
		keywords: wordSet(
			'select from where join left right inner outer full cross on group by order having limit offset insert into values update set delete create table index view sequence drop alter add column primary key foreign references unique not null default and or in as distinct union all case when then else end with returning exists between like ilike asc desc using constraint begin commit rollback',
		),
		types: wordSet(
			'int integer bigint smallint serial varchar char text boolean bool timestamp timestamptz date time numeric decimal real double uuid json jsonb bytea',
		),
		foldCase: true,
	},
	yaml: {
		pattern:
			/(?<comment>(?<=^|\s)#[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:''|[^'\n])*'?)|(?<attr>(?<=^[ \t]*(?:-[ \t]+)?)[A-Za-z_][\w.\/-]*(?=[ \t]*:))|(?<type>[&*][A-Za-z_][\w-]*)|(?<number>\b\d+(?:\.\d+)?\b)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[-:|>[\]{},]+)/gm,
		keywords: wordSet('true false null yes no on off'),
		types: NO_WORDS,
		foldCase: true,
	},
	toml: {
		pattern:
			/(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|"""[\s\S]*|'''[\s\S]*?'''|'''[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?|'[^'\n]*'?)|(?<type>(?<=^[ \t]*)\[\[?[^\]\n]*\]?\]?)|(?<attr>(?<=^[ \t]*)[A-Za-z_][\w.-]*(?=[ \t]*=))|(?<number>\b\d[\d_]*(?:\.\d+)?\b)|(?<ident>[A-Za-z_][\w-]*)|(?<punct>[=.,[\]{}]+)/gm,
		keywords: wordSet('true false'),
		types: NO_WORDS,
	},
	css: {
		pattern:
			/(?<comment>\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<keyword>@[A-Za-z-]+|![A-Za-z-]+)|(?<attr>(?<=[{;]\s*|^\s*)[-A-Za-z]+(?=[ \t]*:))|(?<number>#[\dA-Fa-f]{3,8}\b|-?\b\d*\.?\d+(?:px|r?em|%|s|ms|vh|vw|fr|deg|ch|pt)?\b)|(?<ident>--[A-Za-z_][\w-]*|[A-Za-z_][\w-]*)|(?<punct>[{}();:,>~+*.]+)/gm,
		keywords: wordSet('inherit initial unset revert none auto currentColor transparent'),
		types: NO_WORDS,
	},
	markdown: {
		pattern:
			/(?<keyword>^#{1,6}[ \t][^\n]*)|(?<comment>^[ \t]*>[^\n]*)|(?<string>```[^\n]*|~~~[^\n]*|`[^`\n]*`?)|(?<type>\*\*[^*\n]+\*\*|__[^_\n]+__)|(?<attr>!?\[[^\]\n]*\])|(?<number>(?<=\])\([^)\n]*\))|(?<punct>^[ \t]*(?:[-*+]|\d+\.)[ \t]|^[ \t]*(?:-{3,}|\*{3,})[ \t]*$)/gm,
		keywords: NO_WORDS,
		types: NO_WORDS,
	},
};

const GROUP_KINDS: readonly (readonly [string, TokenKind])[] = [
	['comment', 'comment'],
	['string', 'string'],
	['number', 'number'],
	['attr', 'attr'],
	['flag', 'attr'],
	['keyword', 'keyword'],
	['type', 'type'],
	['lifetime', 'type'],
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

const MARKUP_REGION = /<!--[\s\S]*?-->|<!--[\s\S]*|<\/?[A-Za-z][^>]*>?|<![A-Za-z][^>]*>?/g;
const MARKUP_TAG_HEAD = /^<\/?[A-Za-z][\w:.-]*/u;
const MARKUP_INNER =
	/(?<string>"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?)|(?<attr>[A-Za-z_:][\w:.-]*)|(?<punct>[^\sA-Za-z_:"']+)/g;

function pushMarkupRegion(tokens: CodeToken[], region: string): void {
	if (region.startsWith('<!--')) {
		push(tokens, 'comment', region);
		return;
	}
	const head = MARKUP_TAG_HEAD.exec(region);
	if (head === null) {
		push(tokens, 'plain', region);
		return;
	}
	const openerLength = region.startsWith('</') ? 2 : 1;
	push(tokens, 'punctuation', head[0].slice(0, openerLength));
	push(tokens, 'keyword', head[0].slice(openerLength));

	const rest = region.slice(head[0].length);
	MARKUP_INNER.lastIndex = 0;
	let cursor = 0;
	let match = MARKUP_INNER.exec(rest);
	while (match !== null) {
		push(tokens, 'plain', rest.slice(cursor, match.index));
		const groups = match.groups ?? {};
		push(
			tokens,
			groups.string !== undefined ? 'string' : groups.attr !== undefined ? 'attr' : 'punctuation',
			match[0],
		);
		cursor = match.index + match[0].length;
		match = MARKUP_INNER.exec(rest);
	}
	push(tokens, 'plain', rest.slice(cursor));
}

function tokenizeMarkup(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	MARKUP_REGION.lastIndex = 0;
	let cursor = 0;
	let match = MARKUP_REGION.exec(source);
	while (match !== null) {
		push(tokens, 'plain', source.slice(cursor, match.index));
		pushMarkupRegion(tokens, match[0]);
		cursor = match.index + match[0].length;
		match = MARKUP_REGION.exec(source);
	}
	push(tokens, 'plain', source.slice(cursor));
	return tokens;
}

export function highlightCode(source: string, language: string | null): CodeToken[] {
	if (source.length === 0) return [];
	const resolved = source.length > MAX_HIGHLIGHT_CHARACTERS ? null : normalizeLanguage(language);
	if (resolved === null) return [{ text: source, kind: 'plain' }];
	if (resolved === 'diff') return tokenizeDiff(source);
	if (resolved === 'markup') return tokenizeMarkup(source);
	return tokenizeFamily(source, FAMILIES[resolved]);
}

const DIFF_SHAPE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|^--- .*\n\+\+\+ |^diff --git /mu;
const SHELL_COMMANDS =
	/^[ \t]*[$>]?[ \t]*(?:git|npm|pnpm|yarn|cargo|node|deno|python3?|pip3?|cd|ls|mkdir|rm|cp|mv|cat|echo|curl|wget|grep|rg|sed|awk|make|docker|kubectl|brew|sudo|chmod|find|tar|ssh|bash|sh|zsh|pytest|go|swift|tsc|eslint|prettier|vitest|playwright|xcodebuild)\b/u;
const RUST_SHAPE = /^[ \t]*(?:pub[ \t]+)?(?:fn|impl|struct|enum|trait|mod|use)[ \t]/mu;
const PYTHON_SHAPE =
	/^[ \t]*(?:def|class)[ \t]+\w+[^\n]*:[ \t]*$|^(?:from[ \t]+[\w.]+[ \t]+)?import[ \t]+[\w.,* ]+$/mu;
const TYPESCRIPT_SHAPE =
	/^[ \t]*(?:export[ \t]+)?(?:const|let|var|function|class|interface|type|enum|async[ \t]+function)\b|^[ \t]*import[ \t]+[{*][^\n]*from\b/mu;
const SQL_SHAPE =
	/^[ \t]*(?:select|insert[ \t]+into|update|delete[ \t]+from|create[ \t]+(?:table|index|view)|alter[ \t]+table|with)\b/imu;

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

function detectLanguageUncached(source: string): SupportedLanguage | null {
	if (source.length === 0 || source.length > MAX_HIGHLIGHT_CHARACTERS) return null;
	const head = source.slice(0, 4_000);
	const opening =
		head.split('\n').find((line) => line.trim().length > 0 && !line.trimStart().startsWith('#')) ??
		'';
	if (DIFF_SHAPE.test(head)) return 'diff';
	if (/^#!.*\b(?:bash|sh|zsh)\b/u.test(head) || SHELL_COMMANDS.test(opening)) return 'shell';
	if (RUST_SHAPE.test(head) && /(?:->|\blet\s|::)/u.test(head)) return 'rust';
	if (/^package[ \t]+\w/mu.test(head) || (/\bfunc\s/u.test(head) && /:=/u.test(head))) return 'go';
	if (PYTHON_SHAPE.test(head)) return 'python';
	if (TYPESCRIPT_SHAPE.test(head)) return 'typescript';
	if (SQL_SHAPE.test(head) && /\b(?:from|into|set|values|table)\b/iu.test(head)) return 'sql';
	if (isJsonDocument(source)) return 'json';
	if (/^[ \t]*<[!A-Za-z]/u.test(head) && /<\/[A-Za-z][\w:.-]*>/u.test(head)) return 'markup';
	return null;
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
