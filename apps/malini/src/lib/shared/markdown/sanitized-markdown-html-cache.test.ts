import { describe, expect, it } from 'vitest';
import { BoundedHtmlCache } from '$hyper-ui/components/code-tokens';
import { sanitizedMarkdownHtmlCacheKey } from './sanitized-markdown-html-cache';

describe('sanitized markdown HTML cache', () => {
	it('evicts LRU entries until retained keys and HTML fit the character budget', () => {
		const cache = new BoundedHtmlCache(12);
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
		const cache = new BoundedHtmlCache(5);

		expect(cache.set('long', 'xx')).toBe(false);
		expect(cache.size).toBe(0);
		expect(cache.characterCount).toBe(0);
	});

	it('replaces an existing entry without leaking its previous character weight', () => {
		const cache = new BoundedHtmlCache(20);
		cache.set('key', '12345');
		cache.set('key', 'x');

		expect(cache.size).toBe(1);
		expect(cache.characterCount).toBe(4);
		expect(cache.get('key')).toBe('x');
		cache.clear();
		expect(cache.characterCount).toBe(0);
	});

	it('separates plain and markdown rendering for identical source text', () => {
		expect(sanitizedMarkdownHtmlCacheKey('plain', false, false, 'same')).not.toBe(
			sanitizedMarkdownHtmlCacheKey('markdown', false, false, 'same'),
		);
	});

	it('separates masked and shown personal data for identical source text', () => {
		expect(sanitizedMarkdownHtmlCacheKey('markdown', true, false, 'same')).not.toBe(
			sanitizedMarkdownHtmlCacheKey('markdown', false, false, 'same'),
		);
	});

	it('separates code blocks that offer Run from ones that do not for identical source text', () => {
		expect(sanitizedMarkdownHtmlCacheKey('markdown', false, true, 'same')).not.toBe(
			sanitizedMarkdownHtmlCacheKey('markdown', false, false, 'same'),
		);
	});

	it('rejects non-positive or fractional bounds', () => {
		expect(() => new BoundedHtmlCache(0)).toThrow(RangeError);
		expect(() => new BoundedHtmlCache(1.5)).toThrow(RangeError);
	});
});
