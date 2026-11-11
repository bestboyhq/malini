import { describe, expect, it } from 'vitest';
import { pageStillUrl, stillPageUrl, worktreePageUrl } from './browser';

describe('pageStillUrl', () => {
	it('names the page it pictures, its query and fragment included', () => {
		for (const path of [
			'.context/variant.html',
			'.context/variants.html#b',
			'.context/badge.html?v=2#c',
			'docs/a page.html',
		]) {
			expect(stillPageUrl(pageStillUrl('01JC4ABF', path))).toBe(worktreePageUrl('01JC4ABF', path));
		}
	});

	it('names no page for the page itself', () => {
		expect(stillPageUrl(worktreePageUrl('01JC4ABF', '.context/variants.html#b'))).toBeNull();
	});
});
