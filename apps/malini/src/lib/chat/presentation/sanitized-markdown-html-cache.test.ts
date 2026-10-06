import { describe, expect, it } from 'vitest';
import {
	SanitizedMarkdownHtmlCache,
	sanitizedMarkdownHtmlCacheKey,
} from './sanitized-markdown-html-cache';

describe('SanitizedMarkdownHtmlCache', () => {
	it('evicts the least-recently-used entry when the entry bound is exceeded', () => {
		const cache = new SanitizedMarkdownHtmlCache(2, 100);
		cache.set('first', '<p>1</p>');
		cache.set('second', '<p>2</p>');

		expect(cache.get('first')).toBe('<p>1</p>');
		cache.set('third', '<p>3</p>');

		expect(cache.size).toBe(2);
		expect(cache.get('second')).toBeUndefined();
		expect(cache.get('first')).toBe('<p>1</p>');
		expect(cache.get('third')).toBe('<p>3</p>');
	});

	it('evicts LRU entries until retained keys and HTML fit the character budget', () => {
		const cache = new SanitizedMarkdownHtmlCache(4, 12);
		cache.set('aa', '1111');
		cache.set('bb', '2222');
		expect(cache.characterCount).toBe(12);

		expect(cache.get('aa')).toBe('1111');
		cache.set('c', '33');

		expect(cache.get('bb')).toBeUndefined();
		expect(cache.get('aa')).toBe('1111');
		expect(cache.get('c')).toBe('33');
		expect(cache.characterCount).toBe(9);
	});

	it('does not retain an entry that exceeds the character budget by itself', () => {
		const cache = new SanitizedMarkdownHtmlCache(4, 5);

		expect(cache.set('long', 'xx')).toBe(false);
		expect(cache.size).toBe(0);
		expect(cache.characterCount).toBe(0);
	});

	it('replaces an existing entry without leaking its previous character weight', () => {
		const cache = new SanitizedMarkdownHtmlCache(2, 20);
		cache.set('key', '12345');
		cache.set('key', 'x');

		expect(cache.size).toBe(1);
		expect(cache.characterCount).toBe(4);
		expect(cache.get('key')).toBe('x');
		cache.clear();
		expect(cache.characterCount).toBe(0);
	});

	it('separates plain and markdown rendering for identical source text', () => {
		expect(sanitizedMarkdownHtmlCacheKey('plain', 'same')).not.toBe(
			sanitizedMarkdownHtmlCacheKey('markdown', 'same'),
		);
	});

	it('rejects non-positive or fractional bounds', () => {
		expect(() => new SanitizedMarkdownHtmlCache(0, 10)).toThrow(RangeError);
		expect(() => new SanitizedMarkdownHtmlCache(1, 0)).toThrow(RangeError);
		expect(() => new SanitizedMarkdownHtmlCache(1.5, 10)).toThrow(RangeError);
	});
});
