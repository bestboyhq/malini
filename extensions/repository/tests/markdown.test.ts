import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownHeading, markdownLink, renderMarkdown } from '../src/markdown.js';
import { withDom } from './dom.js';

test('a link in a markdown file resolves against the file it sits in', () => {
	const from = 'docs/adr/0001-local.md';

	assert.deepEqual(markdownLink('0002-contract.md', from), {
		kind: 'file',
		path: 'docs/adr/0002-contract.md',
	});
	assert.deepEqual(markdownLink('../features.md#jobs', from), {
		kind: 'file',
		path: 'docs/features.md',
	});
	assert.deepEqual(markdownLink('/README.md', from), { kind: 'file', path: 'README.md' });
	assert.deepEqual(markdownLink('my%20notes.md', from), {
		kind: 'file',
		path: 'docs/adr/my notes.md',
	});
	assert.deepEqual(markdownLink('today.md', '/Users/someone/plans/notes.md'), {
		kind: 'file',
		path: '/Users/someone/plans/today.md',
	});
	assert.deepEqual(markdownLink('#rule-1', from), { kind: 'heading', slug: 'rule-1' });
	assert.deepEqual(markdownLink('https://bestboy.dev/malini', from), {
		kind: 'web',
		url: 'https://bestboy.dev/malini',
	});
	assert.deepEqual(
		['mailto:ada@example.com', 'javascript:alert(1)', '//example.com/a.md', 'adr/', ''].map(
			(href) => markdownLink(href, from),
		),
		[null, null, null, null, null],
	);
});

test('a heading link finds the heading GitHub anchors it to', async () => {
	await withDom(async () => {
		const article = rendered('# Rule 1 - A claim of "done"\n\n## Setup\n\n## Setup\n');
		const [, first, second] = article.querySelectorAll('h1, h2');

		assert.equal(markdownHeading(article, 'rule-1---a-claim-of-done'), article.querySelector('h1'));
		assert.equal(markdownHeading(article, 'setup'), first);
		assert.equal(markdownHeading(article, 'setup-1'), second);
		assert.equal(markdownHeading(article, 'missing'), null);
	});
});

test('scripts and handlers never reach the page, and front matter stays out of it', async () => {
	await withDom(async () => {
		const article = rendered(
			'---\ntitle: Notes\n---\n\n# Notes\n\n<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)" alt="x">\n',
			(path) => `media://${path}`,
		);

		assert.equal(article.querySelector('script'), null);
		assert.equal(article.querySelector('[onerror]'), null);
		assert.equal(article.querySelectorAll('h1').length, 1);
		assert.equal(article.querySelector('hr'), null);
		assert.doesNotMatch(article.textContent ?? '', /title: Notes/u);
	});
});

test('images load from the worktree right away, and one that cannot reads as its alt text', async () => {
	await withDom(async () => {
		const article = rendered(
			'![Logo](../build/icon.png) ![Release](https://img.shields.io/release.svg) ![](https://example.com/a.png)\n',
			(path) => `media://${path}`,
			'docs/README.md',
		);

		assert.deepEqual(
			[...article.querySelectorAll('img')].map((image) => [
				image.getAttribute('src'),
				image.loading,
			]),
			[['media://build/icon.png', 'eager']],
		);
		assert.match(article.textContent ?? '', /^\s*Release\s*$/u);

		const offline = rendered('![Logo](icon.png)\n');
		assert.equal(offline.querySelector('img'), null);
		assert.equal(offline.textContent?.trim(), 'Logo');
	});
});

function rendered(
	source: string,
	mediaUrl: (path: string) => string | null = () => null,
	path = 'NOTES.md',
): HTMLElement {
	const article = document.createElement('article');
	article.append(renderMarkdown(source, path, mediaUrl));
	return article;
}
