import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import { noAsCasts, noComments, noThenChains, textParser } from '../src/index.mjs';

test('no-then-chains reports promise chains', () => {
	assert.deepEqual(runRule(noThenChains, 'load().then(onLoaded);'), [6]);
	assert.deepEqual(runRule(noThenChains, 'const value = await load();'), []);
});

test('no-as-casts preserves const assertions', () => {
	assert.equal(runRule(noAsCasts, 'const value = input as Workspace;').length, 1);
	assert.deepEqual(runRule(noAsCasts, "const value = 'ready' as const;"), []);
});

test('no-as-casts ignores aliases, strings, and prose', () => {
	assert.deepEqual(runRule(noAsCasts, "export { default as Button } from './Button.svelte';"), []);
	assert.deepEqual(runRule(noAsCasts, "import { A as B } from 'x';"), []);
	assert.deepEqual(runRule(noAsCasts, 'const value = "text as Foo";'), []);
	assert.deepEqual(runRule(noAsCasts, '/** prose as Rust says */\nconst value = 1;'), []);
	assert.deepEqual(runRule(noAsCasts, 'import {\n\tA as B,\n} from "x";'), []);
	assert.deepEqual(runRule(noAsCasts, 'import * as Module from "./Module.svelte";'), []);
	assert.deepEqual(runRule(noAsCasts, 'export * as helpers from "./helpers";'), []);
	assert.deepEqual(runRule(noAsCasts, 'import type { A as B } from "x";'), []);
});

test('no-as-casts still reports a cast inside an exported declaration', () => {
	assert.equal(runRule(noAsCasts, 'export const value = input as Workspace;').length, 1);
	assert.equal(runRule(noAsCasts, 'import "./x";\nconst value = input as Workspace;').length, 1);
	assert.equal(
		runRule(noAsCasts, 'export { a } from "./a";\nconst value = input as Workspace;').length,
		1,
	);
});

test('no-then-chains ignores strings and prose', () => {
	assert.deepEqual(runRule(noThenChains, 'const value = ".then(";'), []);
	assert.deepEqual(runRule(noThenChains, '/** call .then() */\nconst value = 1;'), []);
	assert.equal(runRule(noThenChains, 'load().then(onLoaded);').length, 1);
});

test('no-comments reports prose in every comment shape', () => {
	assert.equal(runRule(noComments, '// explain the branch\nconst value = true;').length, 1);
	assert.equal(runRule(noComments, '/** Public API. */\nexport const value = true;').length, 1);
	assert.equal(runRule(noComments, '<!-- presentation note -->').length, 1);
	assert.equal(runRule(noComments, '/* block narration */\nconst value = true;').length, 1);
	assert.equal(runRule(noComments, 'const value = true; // trailing note').length, 1);
});

test('no-comments keeps a JSDoc block that is only type annotations', () => {
	assert.deepEqual(runRule(noComments, '/** @type {number} */\nconst value = 1;'), []);
	assert.deepEqual(
		runRule(noComments, '/**\n * @param {string} a\n * @returns {number}\n */\nfunction f(a) {}'),
		[],
	);
	assert.deepEqual(
		runRule(noComments, '/** @property {(s: string) => Iterable<number>} find */\nlet x;'),
		[],
	);
	assert.equal(
		runRule(noComments, '/**\n * Prose first.\n * @param {string} a\n */\nfunction f(a) {}').length,
		1,
	);
	assert.equal(
		runRule(noComments, '/**\n * @param {string} a Describes a.\n */\nfunction f(a) {}').length,
		1,
	);
});

test('no-comments never mistakes a URL inside a string for a comment', () => {
	assert.deepEqual(runRule(noComments, 'const u = "https://svelte.dev/e/x";'), []);
	assert.deepEqual(runRule(noComments, "<a href='http://a.test/b'>x</a>"), []);
	assert.deepEqual(
		runRule(noComments, 'a { background: url("data:image/svg+xml,http://n"); }'),
		[],
	);
	assert.deepEqual(runRule(noComments, 'const u = `https://a.test/${x}`;'), []);
});

test('no-comments keeps the directives the toolchain owns', () => {
	assert.deepEqual(runRule(noComments, '// @vitest-environment jsdom\nconst value = true;'), []);
	assert.deepEqual(runRule(noComments, '/* @vite-ignore */\nconst value = import(url);'), []);
	assert.deepEqual(
		runRule(noComments, '// eslint-disable-next-line local/rule\nconst value = true;'),
		[],
	);
	assert.deepEqual(runRule(noComments, '/// <reference types="node" />'), []);
	assert.deepEqual(
		runRule(noComments, '// ponytail: O(n²) scan, index by id past 1k rows\nconst value = true;'),
		[],
	);
	assert.deepEqual(runRule(noComments, '/**\n * @vitest-environment jsdom\n */\nlet x;'), []);
});

test('no-comments strips prose out of a block but keeps its pragma', () => {
	const source = '/**\n * @vitest-environment jsdom\n *\n * Why this file exists.\n */\nlet x;';
	assert.equal(runRule(noComments, source).length, 1);
	assert.equal(applyFix(noComments, source), '/** @vitest-environment jsdom */\nlet x;');
});

test('no-comments strips prose out of a block but keeps its types', () => {
	const source =
		'/**\n * Prose.\n * @param {string} a\n * @returns {number}\n */\nfunction f(a) {}';
	assert.equal(
		applyFix(noComments, source),
		'/**\n * @param {string} a\n * @returns {number}\n */\nfunction f(a) {}',
	);
});

const linter = new Linter();

/**
 * @param {import('eslint').Rule.RuleModule} rule
 * @param {string} source
 * @returns {string}
 */
function applyFix(rule, source) {
	return linter.verifyAndFix(
		source,
		{
			files: ['**/*.svelte'],
			languageOptions: { parser: textParser },
			plugins: { local: { rules: { rule } } },
			rules: { 'local/rule': 'error' },
		},
		'Example.svelte',
	).output;
}

/**
 * @param {import('eslint').Rule.RuleModule} rule
 * @param {string} source
 * @returns {number[]}
 */
function runRule(rule, source) {
	const messages = linter.verify(
		source,
		{
			files: ['**/*.svelte'],
			languageOptions: { parser: textParser },
			plugins: { local: { rules: { rule } } },
			rules: { 'local/rule': 'error' },
		},
		'Example.svelte',
	);
	return messages
		.filter((message) => message.ruleId !== null)
		.map((message) => offsetOf(source, message.line, message.column));
}

/**
 * @param {string} source
 * @param {number} line
 * @param {number} column
 */
function offsetOf(source, line, column) {
	const lines = source.split('\n');
	let offset = 0;
	for (let index = 0; index < line - 1; index += 1) {
		offset += (lines[index] ?? '').length + 1;
	}
	return offset + column - 1;
}
