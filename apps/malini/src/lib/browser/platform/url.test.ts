import { describe, expect, it } from 'vitest';
import {
	isAllowedNavigation,
	isAllowedUrl,
	isFileAddress,
	isLocalUrl,
	normalizeBrowserUrl,
	worktreeFileUrl,
} from './url';

describe('normalizeBrowserUrl', () => {
	it.each([
		['localhost:5173', 'http://localhost:5173/'],
		['localhost', 'http://localhost/'],
		['app.localhost/pricing', 'http://app.localhost/pricing'],
		['127.0.0.1:8080/x?y=1', 'http://127.0.0.1:8080/x?y=1'],
		['[::1]:3000', 'http://[::1]:3000/'],
		['dev.internal:4000', 'http://dev.internal:4000/'],
		['example.com', 'https://example.com/'],
		['example.com/docs#intro', 'https://example.com/docs#intro'],
		['  https://example.com/a  ', 'https://example.com/a'],
		['HTTP://Example.com', 'http://example.com/'],
		['about:blank', 'about:blank'],
		['malini-worktree://ws-1/index.html', 'malini-worktree://ws-1/index.html'],
	])('opens `%s` as %s', (input, expected) => {
		expect(normalizeBrowserUrl(input)).toBe(expected);
	});

	it.each([
		['file:///etc/passwd'],
		['javascript:alert(1)'],
		['data:text/html,hi'],
		['mailto:someone@example.com'],
		['chrome://settings'],
	])('refuses `%s`', (input) => {
		expect(() => normalizeBrowserUrl(input)).toThrow(
			'Only web pages and files in the worktree open in the browser.',
		);
	});

	it('explains an empty or malformed address', () => {
		expect(() => normalizeBrowserUrl('   ')).toThrow('Type a URL to open.');
		expect(() => normalizeBrowserUrl('how to center a div')).toThrow('is not a URL.');
	});
});

describe('worktree files', () => {
	const worktree = '/work/ws';

	it('treats paths and file URLs as files, and everything else as web addresses', () => {
		for (const input of ['/work/ws/a.html', './a.html', '../a.html', ' file:///a.html']) {
			expect(isFileAddress(input)).toBe(true);
		}
		for (const input of ['localhost:5173', 'example.com/a.html', 'a.html', 'about:blank']) {
			expect(isFileAddress(input)).toBe(false);
		}
	});

	it.each([
		['/work/ws/docs/report.html', 'malini-worktree://ws-1/docs/report.html'],
		['./docs/a b.html', 'malini-worktree://ws-1/docs/a%20b.html'],
		['file:///work/ws/index.html?q=1#top', 'malini-worktree://ws-1/index.html?q=1#top'],
		['./report.html?v=A#top', 'malini-worktree://ws-1/report.html?v=A#top'],
		['/work/ws/docs/a b.html#current', 'malini-worktree://ws-1/docs/a%20b.html#current'],
		['./', 'malini-worktree://ws-1/'],
	])('opens `%s` as %s, on a host of its own workstream', (input, expected) => {
		expect(worktreeFileUrl(input, 'WS-1', worktree)).toBe(expected);
	});

	it.each([['/etc/passwd'], ['../other/a.html'], ['file:///work/ws-other/a.html']])(
		'refuses `%s`, which is outside the worktree',
		(input) => {
			expect(() => worktreeFileUrl(input, 'ws-1', worktree)).toThrow('is outside the worktree');
		},
	);
});

describe('isAllowedUrl', () => {
	it('lets only web pages, worktree files and the blank page load', () => {
		expect(isAllowedUrl('https://example.com/')).toBe(true);
		expect(isAllowedUrl('http://localhost:5173/')).toBe(true);
		expect(isAllowedUrl('malini-worktree://ws-1/index.html')).toBe(true);
		expect(isAllowedUrl('about:blank')).toBe(true);
		expect(isAllowedUrl('file:///Users/me/secret.txt')).toBe(false);
		expect(isAllowedUrl('vscode://file/x')).toBe(false);
		expect(isAllowedUrl('not a url')).toBe(false);
	});
});

describe('isAllowedNavigation', () => {
	it('lets a page reach worktree files only from the same worktree', () => {
		const page = 'malini-worktree://ws-1/index.html';
		expect(isAllowedNavigation(page, 'malini-worktree://ws-1/docs/next.html')).toBe(true);
		expect(isAllowedNavigation(page, 'https://example.com/')).toBe(true);
		expect(isAllowedNavigation(page, 'malini-worktree://ws-2/.env')).toBe(false);
		expect(isAllowedNavigation('https://example.com/', 'malini-worktree://ws-1/.env')).toBe(false);
		expect(isAllowedNavigation('https://example.com/', 'file:///etc/passwd')).toBe(false);
		expect(isAllowedNavigation('https://example.com/', 'https://example.org/')).toBe(true);
	});
});

describe('isLocalUrl', () => {
	it('knows the hosts a dev server listens on', () => {
		expect(isLocalUrl('http://localhost:5173/')).toBe(true);
		expect(isLocalUrl('http://127.0.0.1:8080/')).toBe(true);
		expect(isLocalUrl('http://[::1]:3000/')).toBe(true);
		expect(isLocalUrl('https://example.com/')).toBe(false);
		expect(isLocalUrl('malini-worktree://ws-1/')).toBe(false);
	});
});
