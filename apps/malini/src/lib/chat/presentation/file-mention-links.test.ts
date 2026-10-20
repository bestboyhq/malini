// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { linkifyFileMentions, parseFileMention, readFileMentionTarget } from './file-mention-links';

type Mention = { text: string; path: string; line: number | null };

function mentions(html: string): Mention[] {
	const host = document.createElement('div');
	host.innerHTML = linkifyFileMentions(html);
	return [...host.querySelectorAll('a')].flatMap((anchor) => {
		const target = readFileMentionTarget(anchor);
		return target ? [{ text: anchor.textContent ?? '', ...target }] : [];
	});
}

function paths(html: string): string[] {
	return mentions(html).map((mention) => mention.path);
}

describe('file mentions in an agent answer', () => {
	it('links an inline code span that is nothing but a path', () => {
		expect(mentions('<p>I changed <code>src/lib/render.ts</code> today.</p>')).toEqual([
			{ text: 'src/lib/render.ts', path: 'src/lib/render.ts', line: null },
		]);
	});

	it('keeps the code span inside the link so it still reads as machine text', () => {
		const host = document.createElement('div');
		host.innerHTML = linkifyFileMentions('<p>See <code>src/app.ts</code>.</p>');
		expect(host.querySelector('a > code')?.textContent).toBe('src/app.ts');
	});

	it('links a bare file name in a code span, where the agent means the file', () => {
		expect(paths('<p>Bumped <code>package.json</code>.</p>')).toEqual(['package.json']);
	});

	it('links a path written bare in prose', () => {
		expect(
			mentions('<p>The projector lives in src/lib/chat/presentation/render-state.ts today.</p>'),
		).toEqual([
			{
				text: 'src/lib/chat/presentation/render-state.ts',
				path: 'src/lib/chat/presentation/render-state.ts',
				line: null,
			},
		]);
	});

	it('keeps the sentence around a linked path intact', () => {
		const host = document.createElement('div');
		host.innerHTML = linkifyFileMentions('<p>Look at src/app.ts, then stop.</p>');
		expect(host.textContent).toBe('Look at src/app.ts, then stop.');
	});

	it('takes a trailing full stop as punctuation rather than as part of the path', () => {
		expect(mentions('<p>Fixed in src/app.ts.</p>')).toEqual([
			{ text: 'src/app.ts', path: 'src/app.ts', line: null },
		]);
	});

	it('unwraps a path from the brackets a sentence puts around it', () => {
		expect(mentions('<p>Done (see src/app.ts) already.</p>')).toEqual([
			{ text: 'src/app.ts', path: 'src/app.ts', line: null },
		]);
	});

	it('links a relative path even without an extension, because ./ says it is a path', () => {
		expect(paths('<p>Run ./scripts/release from the root.</p>')).toEqual(['scripts/release']);
		expect(paths('<p>It reads ../shared/config there.</p>')).toEqual(['../shared/config']);
	});

	it('captures a line number and strips it from the path', () => {
		expect(mentions('<p>Throws at src/app.ts:42 on startup.</p>')).toEqual([
			{ text: 'src/app.ts:42', path: 'src/app.ts', line: 42 },
		]);
	});

	it('captures the line and drops the column of a compiler-style location', () => {
		expect(mentions('<p>See <code>src/app.ts:42:7</code>.</p>')).toEqual([
			{ text: 'src/app.ts:42:7', path: 'src/app.ts', line: 42 },
		]);
	});

	it('relativizes an absolute workstream path to what the repository calls it', () => {
		expect(paths('<p>Wrote /Users/me/workstreams/01J8/src/server.js just now.</p>')).toEqual([
			'src/server.js',
		]);
	});

	it('links every mention in a paragraph, not just the first', () => {
		expect(paths('<p>Moved src/a.ts into src/b.ts.</p>')).toEqual(['src/a.ts', 'src/b.ts']);
	});

	it('emits no href, so an in-app file never reaches the external-link branch', () => {
		const host = document.createElement('div');
		host.innerHTML = linkifyFileMentions('<p>See <code>src/app.ts</code>.</p>');
		const anchor = host.querySelector('a');
		expect(anchor?.hasAttribute('href')).toBe(false);
		expect(anchor?.getAttribute('role')).toBe('link');
		expect(anchor?.getAttribute('tabindex')).toBe('0');
	});

	it('is idempotent, so a re-render of the same block cannot nest links', () => {
		const once = linkifyFileMentions('<p>See <code>src/app.ts</code> and src/b.ts.</p>');
		expect(linkifyFileMentions(once)).toBe(once);
	});

	it('returns the fragment untouched when it holds no mention', () => {
		const html = '<p>Nothing to open here.</p>';
		expect(linkifyFileMentions(html)).toBe(html);
	});
});

describe('file mentions leave everything that is not a path alone', () => {
	it('never links inside a fenced code block', () => {
		expect(paths('<pre><code>import x from "src/app.ts";\n</code></pre>')).toEqual([]);
	});

	it('never links inside an existing link', () => {
		expect(paths('<p><a href="https://example.com">src/app.ts</a></p>')).toEqual([]);
	});

	it('never links a word pair that only shares a slash', () => {
		expect(paths('<p>Pass and/or fail, TODO/FIXME either way.</p>')).toEqual([]);
		expect(paths('<p>Use <code>and/or</code> here.</p>')).toEqual([]);
	});

	it('never links a ratio or a date', () => {
		expect(paths('<p>It runs 24/7 and shipped on 12/25/2024.</p>')).toEqual([]);
		expect(paths('<p>Roughly 1/2 of the runs, or 3.5/4.0 of them.</p>')).toEqual([]);
	});

	it('never links a bare file name in prose, where it is a noun', () => {
		expect(paths('<p>The package.json version was already correct.</p>')).toEqual([]);
	});

	it('never links a regular expression or arithmetic in prose', () => {
		expect(paths('<p>Applies s/foo/bar/ to the line and /\\d+/g to the rest.</p>')).toEqual([]);
		expect(paths('<p>The result is (a+b)/2 per item.</p>')).toEqual([]);
	});

	it('never links a property access that looks like a file name', () => {
		expect(paths('<p>Call <code>console.log</code> when it fails.</p>')).toEqual([]);
		expect(
			paths('<p>Use <code>Array.prototype.map</code> and <code>process.env</code>.</p>'),
		).toEqual([]);
	});

	it('links a bare .json property access, and that is the accepted cost of .json', () => {
		expect(paths('<p>Await <code>response.json</code> first.</p>')).toEqual(['response.json']);
	});

	it('never links a URL as a file', () => {
		expect(paths('<p>Read https://example.com/docs/guide.md first.</p>')).toEqual([]);
		expect(paths('<p>Mirrored at www.example.com/guide.md too.</p>')).toEqual([]);
	});

	it('never links a directory, which has no file to open', () => {
		expect(paths('<p>Everything under src/lib/chat/ moved.</p>')).toEqual([]);
	});

	it('never links two file names an agent joined with a slash', () => {
		expect(paths('<p>Documented in <code>AGENTS.md/CLAUDE.md</code> for now.</p>')).toEqual([]);
		expect(paths('<p>Either src/a.ts/src/b.ts would do.</p>')).toEqual([]);
	});

	it('never links a path an agent elided the middle of', () => {
		expect(paths('<p>It lives at <code>apps/malini/src/lib/...ts</code> somewhere.</p>')).toEqual(
			[],
		);
	});
});

describe('the recognizer itself', () => {
	it('separates prose from machine text with one flag', () => {
		expect(parseFileMention('package.json', { requireSlash: true })).toBeNull();
		expect(parseFileMention('package.json', { requireSlash: false })).toEqual({
			path: 'package.json',
			line: null,
		});
	});

	it('refuses a path longer than anything an agent would name', () => {
		expect(parseFileMention(`src/${'a'.repeat(300)}.ts`, { requireSlash: true })).toBeNull();
	});

	it('refuses a line number that is not one', () => {
		expect(parseFileMention('src/app.ts:0', { requireSlash: true })).toEqual({
			path: 'src/app.ts',
			line: null,
		});
	});
});
