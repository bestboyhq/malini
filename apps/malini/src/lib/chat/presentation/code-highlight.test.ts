import { describe, expect, it } from 'vitest';
import {
	detectLanguage,
	highlightCode,
	highlightDiffLines,
	languageForPath,
	languageHintLabel,
	languageLabel,
	normalizeLanguage,
	resolveLanguage,
	type CodeToken,
	type SupportedLanguage,
	type TokenKind,
} from '@malini/extension-api';

function kindOf(tokens: readonly CodeToken[], text: string): TokenKind | undefined {
	return tokens.find((token) => token.text === text)?.kind;
}

function kinds(tokens: readonly CodeToken[]): ReadonlySet<TokenKind> {
	return new Set(tokens.map((token) => token.kind));
}

function reassemble(tokens: readonly CodeToken[]): string {
	return tokens.map((token) => token.text).join('');
}

describe('normalizeLanguage', () => {
	it('folds every alias an agent actually writes onto one family', () => {
		expect(normalizeLanguage('ts')).toBe('typescript');
		expect(normalizeLanguage('TSX')).toBe('typescript');
		expect(normalizeLanguage('jsx')).toBe('typescript');
		expect(normalizeLanguage('rs')).toBe('rust');
		expect(normalizeLanguage('zsh')).toBe('shell');
		expect(normalizeLanguage('patch')).toBe('diff');
		expect(normalizeLanguage('yml')).toBe('yaml');
		expect(normalizeLanguage('svelte')).toBe('markup');
	});

	it('reads only the first word of a fence info string', () => {
		expect(normalizeLanguage('ts title="ensure.ts"')).toBe('typescript');
		expect(normalizeLanguage('language-rust')).toBe('rust');
	});

	it('refuses to guess from an unknown or absent hint', () => {
		expect(normalizeLanguage(null)).toBeNull();
		expect(normalizeLanguage('')).toBeNull();
		expect(normalizeLanguage('brainfuck')).toBeNull();
	});

	it('reads every language it resolves to back as itself', () => {
		const resolved: readonly SupportedLanguage[] = [
			'typescript',
			'markup',
			'markdown',
			'csharp',
			'dockerfile',
			'generic',
			'text',
		];
		for (const language of resolved) expect(normalizeLanguage(language)).toBe(language);
	});

	it('reads a file name written where the language goes', () => {
		expect(normalizeLanguage('src/app/ChatTabs.svelte')).toBe('markup');
		expect(normalizeLanguage('Dockerfile')).toBe('dockerfile');
		expect(normalizeLanguage('.env')).toBe('ini');
	});

	it('names the language a fence wrote, not the grammar it borrows', () => {
		expect(languageHintLabel('js')).toBe('JavaScript');
		expect(languageHintLabel('JSX')).toBe('JavaScript');
		expect(languageHintLabel('svelte')).toBe('Svelte');
		expect(languageHintLabel('xml')).toBe('XML');
		expect(languageHintLabel('scss')).toBe('SCSS');
		expect(languageHintLabel('ts title="ensure.ts"')).toBe('TypeScript');
		expect(languageHintLabel('language-rust')).toBe('Rust');
		expect(languageHintLabel('brainfuck')).toBeNull();
		expect(languageHintLabel(null)).toBeNull();
	});

	it('names a language for the block header', () => {
		expect(languageLabel('typescript')).toBe('TypeScript');
		expect(languageLabel('shell')).toBe('Shell');
		expect(languageLabel('csharp')).toBe('C#');
		expect(languageLabel('generic')).toBeNull();
		expect(languageLabel(null)).toBeNull();
	});
});

describe('languageForPath', () => {
	it('reads the language from the extension, or from names that carry none', () => {
		expect(languageForPath('apps/malini/src/lib/chat/presentation/ChatTabs.svelte')).toBe('markup');
		expect(languageForPath('src/main.rs')).toBe('rust');
		expect(languageForPath('include/vector.hpp')).toBe('c');
		expect(languageForPath('docker/Dockerfile.dev')).toBe('dockerfile');
		expect(languageForPath('Makefile')).toBe('makefile');
		expect(languageForPath('.env.local')).toBe('ini');
		expect(languageForPath('.gitignore')).toBe('ini');
		expect(languageForPath('notes.txt')).toBe('text');
		expect(languageForPath('LICENSE')).toBeNull();
	});
});

describe('resolveLanguage', () => {
	it('colors code in a language it has no grammar for rather than leaving it plain', () => {
		expect(resolveLanguage('haskell', 'main = putStrLn "hi"')).toBe('generic');
		expect(resolveLanguage(null, 'count = compute(1, "two");\nnext(count);')).toBe('generic');
	});

	it('leaves prose and declared plain text plain', () => {
		expect(resolveLanguage(null, "This isn't code, it's a sentence.")).toBe('text');
		expect(resolveLanguage('text', 'const x = 1;')).toBe('text');
	});
});

describe('highlightCode', () => {
	it('colors code whose language is unknown or absent', () => {
		const source = 'run(input) { let total = 1; return "done"; }';
		for (const hint of [null, 'brainfuck']) {
			const tokens = highlightCode(source, hint);
			expect(kindOf(tokens, '"done"')).toBe('string');
			expect(kindOf(tokens, 'run')).toBe('function');
			expect(reassemble(tokens)).toBe(source);
		}
		expect(highlightCode('', 'rust')).toEqual([]);
	});

	it('leaves prose plain, apostrophes included', () => {
		const prose = "The staging failure isn't a git bug, it's a socket one.";
		expect(highlightCode(prose, null)).toEqual([{ text: prose, kind: 'plain' }]);
	});

	it('colors a block of any size', () => {
		const source = `${'let value = 1;\n'.repeat(80_000)}`;
		const tokens = highlightCode(source, 'ts');
		expect(kindOf(tokens, 'let')).toBe('keyword');
		expect(reassemble(tokens)).toBe(source);
	});

	it('never drops or reorders a character of the source', () => {
		const source = [
			'// header',
			'const label: string = "a \\" b";',
			'const total = 0x1f + 42;',
			'export function run(input: Config) { return input; }',
		].join('\n');
		expect(reassemble(highlightCode(source, 'ts'))).toBe(source);
	});
});

describe('per-language tokenizing', () => {
	it('colors typescript comments, strings, keywords, types and calls', () => {
		const tokens = highlightCode(
			['// why', 'export const run = (input: Config): number => parse(input) + 1;'].join('\n'),
			'ts',
		);
		expect(kindOf(tokens, '// why')).toBe('comment');
		expect(kindOf(tokens, 'export')).toBe('keyword');
		expect(kindOf(tokens, 'Config')).toBe('type');
		expect(kindOf(tokens, 'number')).toBe('type');
		expect(kindOf(tokens, 'parse')).toBe('function');
		expect(kindOf(tokens, '1')).toBe('number');
	});

	it('keeps a keyword inside a typescript string uncolored', () => {
		const tokens = highlightCode('const note = "return if else";', 'ts');
		expect(kindOf(tokens, '"return if else"')).toBe('string');
		expect(kindOf(tokens, 'return')).toBeUndefined();
	});

	it('colors rust items, attributes, lifetimes and macros', () => {
		const tokens = highlightCode(
			[
				'#[derive(Debug)]',
				'fn ensure_staging_precondition(repo: &Repository) -> Result<Staged> {',
				'    let probe = TcpListener::bind(("127.0.0.1", 0))?; // steal window',
				'    println!("port {}", probe.local_addr()?.port());',
				'}',
			].join('\n'),
			'rust',
		);
		expect(kindOf(tokens, '#[derive(Debug)]')).toBe('attr');
		expect(kindOf(tokens, 'fn')).toBe('keyword');
		expect(kindOf(tokens, 'ensure_staging_precondition')).toBe('function');
		expect(kindOf(tokens, 'Repository')).toBe('type');
		expect(kindOf(tokens, 'Result')).toBe('type');
		expect(kindOf(tokens, '// steal window')).toBe('comment');
		expect(kindOf(tokens, '"127.0.0.1"')).toBe('string');
	});

	it('reads a rust lifetime as a type rather than an unterminated char literal', () => {
		const tokens = highlightCode("fn head<'a>(input: &'a str) -> &'a str { input }", 'rust');
		expect(kindOf(tokens, "'a")).toBe('type');
		expect(kinds(tokens).has('string')).toBe(false);
	});

	it('colors python decorators, triple-quoted strings and defs', () => {
		const tokens = highlightCode(
			['@retry', 'def probe(port: int) -> bool:', '    """Docs."""', '    return port > 0'].join(
				'\n',
			),
			'python',
		);
		expect(kindOf(tokens, '@retry')).toBe('attr');
		expect(kindOf(tokens, 'def')).toBe('keyword');
		expect(kindOf(tokens, 'probe')).toBe('function');
		expect(kindOf(tokens, '"""Docs."""')).toBe('string');
		expect(kindOf(tokens, 'int')).toBe('type');
	});

	it('colors the head of a shell pipeline, its flags and its variables', () => {
		const tokens = highlightCode(
			['# stage everything', 'git add -A -- .', 'echo ${BRANCH} | grep -q $HOME'].join('\n'),
			'bash',
		);
		expect(kindOf(tokens, '# stage everything')).toBe('comment');
		expect(kindOf(tokens, 'git')).toBe('function');
		expect(kindOf(tokens, 'grep')).toBe('function');
		expect(kindOf(tokens, '-A')).toBe('attr');
		expect(kindOf(tokens, '${BRANCH}')).toBe('attr');
		expect(kindOf(tokens, '$HOME')).toBe('attr');
	});

	it('keeps a shell comment marker inside a quoted string out of the comment color', () => {
		const tokens = highlightCode('echo "count #42 done"', 'sh');
		expect(kindOf(tokens, '"count #42 done"')).toBe('string');
		expect(kinds(tokens).has('comment')).toBe(false);
	});

	it('separates json keys from json strings', () => {
		const tokens = highlightCode('{ "name": "malini", "count": 3, "ok": true }', 'json');
		expect(kindOf(tokens, '"name"')).toBe('attr');
		expect(kindOf(tokens, '"malini"')).toBe('string');
		expect(kindOf(tokens, '3')).toBe('number');
		expect(kindOf(tokens, 'true')).toBe('keyword');
	});

	it('colors go declarations and raw strings', () => {
		const tokens = highlightCode(
			['package main', '', 'func Probe(port int) error {', '\treturn nil', '}'].join('\n'),
			'go',
		);
		expect(kindOf(tokens, 'package')).toBe('keyword');
		expect(kindOf(tokens, 'Probe')).toBe('function');
		expect(kindOf(tokens, 'int')).toBe('type');
		expect(kindOf(tokens, 'nil')).toBe('type');
	});

	it('colors sql keywords whatever case they are written in', () => {
		const tokens = highlightCode("select id from runs where name = 'malini' -- note", 'sql');
		expect(kindOf(tokens, 'select')).toBe('keyword');
		expect(kindOf(tokens, 'where')).toBe('keyword');
		expect(kindOf(tokens, "'malini'")).toBe('string');
		expect(kindOf(tokens, '-- note')).toBe('comment');
		expect(kindOf(highlightCode('SELECT 1', 'sql'), 'SELECT')).toBe('keyword');
	});

	it('colors yaml keys, anchors and scalars', () => {
		const tokens = highlightCode(
			['# ci', 'name: build', 'jobs:', '  - run: pnpm test', '    shell: true'].join('\n'),
			'yaml',
		);
		expect(kindOf(tokens, '# ci')).toBe('comment');
		expect(kindOf(tokens, 'name')).toBe('attr');
		expect(kindOf(tokens, 'run')).toBe('attr');
		expect(kindOf(tokens, 'true')).toBe('keyword');
	});

	it('colors toml tables and keys', () => {
		const tokens = highlightCode(
			['[package]', 'name = "malini"', 'edition = 2021'].join('\n'),
			'toml',
		);
		expect(kindOf(tokens, '[package]')).toBe('type');
		expect(kindOf(tokens, 'name')).toBe('attr');
		expect(kindOf(tokens, '"malini"')).toBe('string');
		expect(kindOf(tokens, '2021')).toBe('number');
	});

	it('colors css at-rules, properties and units', () => {
		const tokens = highlightCode(
			['@media (min-width: 40rem) {', '  .row { padding: 0.5rem; color: inherit; }', '}'].join(
				'\n',
			),
			'css',
		);
		expect(kindOf(tokens, '@media')).toBe('keyword');
		expect(kindOf(tokens, 'padding')).toBe('attr');
		expect(kindOf(tokens, '0.5rem')).toBe('number');
		expect(kindOf(tokens, 'inherit')).toBe('keyword');
	});

	it('colors markup tags and attributes without touching the text between them', () => {
		const tokens = highlightCode('<a href="https://malini.dev">read the docs</a>', 'html');
		expect(kindOf(tokens, 'a')).toBe('keyword');
		expect(kindOf(tokens, 'href')).toBe('attr');
		expect(kindOf(tokens, '"https://malini.dev"')).toBe('string');
		expect(kindOf(tokens, 'read the docs')).toBe('plain');
	});

	it('colors the script, style and template expressions of a svelte component', () => {
		const source = [
			'<script lang="ts">',
			"\tconst label: string = 'Close';",
			'</script>',
			'',
			'{#if open}',
			'\t<button onclick={() => close(label)} class="tab {active}">{label}</button>',
			'{/if}',
			'',
			'<style>',
			'\t.tab { color: red; }',
			'</style>',
		].join('\n');
		const tokens = highlightCode(source, 'svelte');
		expect(kindOf(tokens, 'const')).toBe('keyword');
		expect(kindOf(tokens, "'Close'")).toBe('string');
		expect(kindOf(tokens, '#if')).toBe('keyword');
		expect(kindOf(tokens, 'close')).toBe('function');
		expect(kindOf(tokens, 'onclick')).toBe('attr');
		expect(kindOf(tokens, 'color')).toBe('attr');
		expect(kindOf(tokens, 'button')).toBe('keyword');
		expect(reassemble(tokens)).toBe(source);
	});

	it('keeps a tag whole when an expression inside it holds a closing angle bracket', () => {
		const tokens = highlightCode('<div hidden={count > 1}>text</div>', 'svelte');
		expect(kindOf(tokens, 'text')).toBe('plain');
		expect(tokens.filter((token) => token.text === 'div')).toHaveLength(2);
	});

	it('reads vue directive values as code', () => {
		const tokens = highlightCode(
			'<li v-for="item in items" :key="item.id">{{ item.name }}</li>',
			'vue',
		);
		expect(kindOf(tokens, 'in')).toBe('keyword');
		expect(kindOf(tokens, ':key')).toBe('attr');
	});

	it('colors the code inside a markdown fence by the fence language', () => {
		const source = ['# Setup', '', '```ts', 'const port = 3000;', '```', '', 'Done.'].join('\n');
		const tokens = highlightCode(source, 'md');
		expect(kindOf(tokens, '# Setup')).toBe('keyword');
		expect(kindOf(tokens, 'const')).toBe('keyword');
		expect(kindOf(tokens, '3000')).toBe('number');
		expect(reassemble(tokens)).toBe(source);
	});

	it('colors java, c, c#, kotlin, swift, ruby, lua, php and graphql', () => {
		expect(kindOf(highlightCode('@Override public void run() {}', 'java'), '@Override')).toBe(
			'attr',
		);
		expect(kindOf(highlightCode('#include <stdio.h>\nint main() {}', 'c'), '<stdio.h>')).toBe(
			'string',
		);
		expect(kindOf(highlightCode('var path = @"C:\\tmp";', 'cs'), '@"C:\\tmp"')).toBe('string');
		expect(kindOf(highlightCode('fun main() { val x = 1 }', 'kt'), 'fun')).toBe('keyword');
		expect(kindOf(highlightCode('guard let x = y else { return }', 'swift'), 'guard')).toBe(
			'keyword',
		);
		expect(kindOf(highlightCode('def run\n  @count += 1\nend', 'rb'), '@count')).toBe('attr');
		expect(kindOf(highlightCode('local x = 1 -- note', 'lua'), '-- note')).toBe('comment');
		expect(kindOf(highlightCode('<p><?php echo $name; ?></p>', 'php'), '$name')).toBe('attr');
		expect(kindOf(highlightCode('query Run($id: ID!) { run(id: $id) }', 'graphql'), 'query')).toBe(
			'keyword',
		);
	});

	it('colors a dockerfile, a makefile and an env file', () => {
		const docker = highlightCode('FROM node:22 AS build\nRUN pnpm install', 'dockerfile');
		expect(kindOf(docker, 'FROM')).toBe('keyword');
		expect(kindOf(docker, 'RUN')).toBe('keyword');
		const make = highlightCode('build: deps\n\tgo build $(FLAGS)', 'makefile');
		expect(kindOf(make, 'build')).toBe('function');
		expect(kindOf(make, '$(FLAGS)')).toBe('attr');
		expect(kindOf(highlightCode('# local\nPORT=3000', '.env'), 'PORT')).toBe('attr');
	});

	it('reads a regular expression literal whole, quotes and all', () => {
		const tokens = highlightCode("const quote = /'/g; const next = 'ok';", 'ts');
		expect(kindOf(tokens, "/'/g")).toBe('string');
		expect(kindOf(tokens, "'ok'")).toBe('string');
	});

	it('colors markdown headings, fences and emphasis', () => {
		const tokens = highlightCode(
			['## What I measured', '', 'A `probe` and **a claim**.'].join('\n'),
			'md',
		);
		expect(kindOf(tokens, '## What I measured')).toBe('keyword');
		expect(kindOf(tokens, '`probe`')).toBe('string');
		expect(kindOf(tokens, '**a claim**')).toBe('type');
	});
});

describe('streaming safety', () => {
	it('tokenizes an unterminated string to the end of the input', () => {
		const tokens = highlightCode('const label = "still typ', 'ts');
		expect(kindOf(tokens, '"still typ')).toBe('string');
		expect(reassemble(tokens)).toBe('const label = "still typ');
	});

	it('tokenizes an unterminated block comment to the end of the input', () => {
		const source = 'fn main() {\n/* the reason is that';
		const tokens = highlightCode(source, 'rust');
		expect(kindOf(tokens, '/* the reason is that')).toBe('comment');
		expect(reassemble(tokens)).toBe(source);
	});

	it('tokenizes an unterminated python docstring to the end of the input', () => {
		const source = 'def probe():\n    """Opens a socket and';
		const tokens = highlightCode(source, 'python');
		expect(kindOf(tokens, '"""Opens a socket and')).toBe('string');
		expect(reassemble(tokens)).toBe(source);
	});

	it('agrees with itself as a fence grows one character at a time', () => {
		const source = 'let probe = TcpListener::bind("127.0.0.1")?; // note';
		for (let end = 1; end <= source.length; end += 1) {
			const partial = source.slice(0, end);
			expect(reassemble(highlightCode(partial, 'rust'))).toBe(partial);
		}
		expect(kindOf(highlightCode(source, 'rust'), '// note')).toBe('comment');
	});

	it('stays fast enough for a multi-thousand-line block on a 220ms reveal tick', () => {
		const source = `${'export const value: number = compute(1, "two"); // note\n'.repeat(3_000)}`;
		const started = performance.now();
		highlightCode(source, 'ts');
		expect(performance.now() - started).toBeLessThan(220);
	});
});

describe('diff', () => {
	it('colors whole lines by their leading marker', () => {
		const source = [
			'diff --git a/src/git.rs b/src/git.rs',
			'--- a/src/git.rs',
			'+++ b/src/git.rs',
			'@@ -410,6 +410,7 @@ fn ensure_staging_precondition(',
			' let port = probe.local_addr()?.port();',
			'-    bind_exact(port)',
			'+    retry_on_steal(|| bind_exact(port))',
			'',
		].join('\n');
		const tokens = highlightCode(source, 'diff');
		expect(tokens[0]).toEqual({
			kind: 'comment',
			text: 'diff --git a/src/git.rs b/src/git.rs\n--- a/src/git.rs\n+++ b/src/git.rs\n',
		});
		expect(kindOf(tokens, '@@ -410,6 +410,7 @@ fn ensure_staging_precondition(\n')).toBe(
			'function',
		);
		expect(kindOf(tokens, '-    bind_exact(port)\n')).toBe('removed');
		expect(kindOf(tokens, '+    retry_on_steal(|| bind_exact(port))\n')).toBe('added');
		expect(kindOf(tokens, ' let port = probe.local_addr()?.port();\n')).toBe('plain');
		expect(reassemble(tokens)).toBe(source);
	});
});

describe('highlightDiffLines', () => {
	it('colors each side of a diff with the lines around it, not one line at a time', () => {
		const lines = highlightDiffLines(
			[
				{ text: '/* opened here', side: 'both' },
				{ text: 'const removed = 1;', side: 'old' },
				{ text: '*/ const added = 2;', side: 'new' },
			],
			'ts',
		);
		expect(new Set(lines[1]?.map((token) => token.kind))).toEqual(new Set(['comment']));
		expect(lines[1]?.map((token) => token.text).join('')).toBe('const removed = 1;');
		expect(lines[2]?.[0]).toMatchObject({ kind: 'comment', text: '*/' });
		expect(kindOf(lines[2] ?? [], 'const')).toBe('keyword');
	});
});

describe('detectLanguage', () => {
	it('recognizes the shapes only one language has', () => {
		expect(
			detectLanguage(
				[
					'fn ensure_staging_precondition(repo: &Repository) -> Result<Staged> {',
					'    let probe = TcpListener::bind(("127.0.0.1", 0))?;',
					'}',
				].join('\n'),
			),
		).toBe('rust');
		expect(detectLanguage('export const run = (input: Config) => input;')).toBe('typescript');
		expect(detectLanguage('def probe(port):\n    return port')).toBe('python');
		expect(detectLanguage('git add -A -- .')).toBe('shell');
		expect(detectLanguage('# stage everything\ngit add -A -- .')).toBe('shell');
		expect(detectLanguage('@@ -1,2 +1,3 @@\n-old\n+new')).toBe('diff');
		expect(detectLanguage('{\n  "name": "malini"\n}')).toBe('json');
		expect(detectLanguage('package main\n\nfunc main() {}')).toBe('go');
		expect(detectLanguage('select id from runs')).toBe('sql');
		expect(detectLanguage('#include <stdio.h>\nint main(void) { return 0; }')).toBe('c');
		expect(detectLanguage('package dev.malini;\n\npublic class Run {}')).toBe('java');
		expect(detectLanguage('FROM node:22\nRUN pnpm install')).toBe('dockerfile');
		expect(detectLanguage('name: ci\non: push\njobs:\n  test: {}')).toBe('yaml');
		expect(detectLanguage('.tab {\n  color: red;\n}')).toBe('css');
	});

	it('returns null rather than coloring prose or an unrecognized shape', () => {
		expect(detectLanguage('')).toBeNull();
		expect(
			detectLanguage('The staging failure is a socket lifetime bug, not a git one.'),
		).toBeNull();
		expect(detectLanguage('a b c\nd e f')).toBeNull();
	});
});
