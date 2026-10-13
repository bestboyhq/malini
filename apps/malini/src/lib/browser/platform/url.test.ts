import { describe, expect, it } from 'vitest';
import { isAllowedUrl, normalizeBrowserUrl } from './url';

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
			'Only http and https pages open in the browser.',
		);
	});

	it('explains an empty or malformed address', () => {
		expect(() => normalizeBrowserUrl('   ')).toThrow('Type a URL to open.');
		expect(() => normalizeBrowserUrl('how to center a div')).toThrow('is not a URL.');
	});
});

describe('isAllowedUrl', () => {
	it('lets only web pages and the blank page load', () => {
		expect(isAllowedUrl('https://example.com/')).toBe(true);
		expect(isAllowedUrl('http://localhost:5173/')).toBe(true);
		expect(isAllowedUrl('about:blank')).toBe(true);
		expect(isAllowedUrl('file:///Users/me/secret.txt')).toBe(false);
		expect(isAllowedUrl('vscode://file/x')).toBe(false);
		expect(isAllowedUrl('not a url')).toBe(false);
	});
});
