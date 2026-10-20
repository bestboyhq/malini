import { describe, expect, it } from 'vitest';

import { containsPrivateUse, privateUseRanges } from './strip-private-use';

const LEFT_ARROW = '\u{F702}';
const RIGHT_ARROW = '\u{F703}';

describe('private-use detection', () => {
	it('finds the arrow-key codepoints the webview inserts', () => {
		expect(containsPrivateUse(RIGHT_ARROW)).toBe(true);
		expect(containsPrivateUse(`rename${LEFT_ARROW} the heading`)).toBe(true);
	});

	it('leaves ordinary prompt text alone', () => {
		expect(containsPrivateUse('rename the heading')).toBe(false);
		expect(containsPrivateUse('emoji 🎉 and accents éàü are content')).toBe(false);
		expect(containsPrivateUse('[[context:src/routes/+page.svelte]]')).toBe(false);
	});

	it('does not treat the chip glyphs as private use', () => {
		expect(containsPrivateUse('▣◧◆◍⌗')).toBe(false);
	});

	it('reports every run so a whole burst of arrow presses is removed at once', () => {
		const text = `a${RIGHT_ARROW}b${LEFT_ARROW}${RIGHT_ARROW}c`;
		expect(privateUseRanges(text)).toEqual([
			{ from: 1, to: 2 },
			{ from: 3, to: 4 },
			{ from: 4, to: 5 },
		]);
	});

	it('is not stateful across calls', () => {
		const text = `x${RIGHT_ARROW}`;
		expect(privateUseRanges(text)).toHaveLength(1);
		expect(privateUseRanges(text)).toHaveLength(1);
		expect(containsPrivateUse(text)).toBe(true);
		expect(containsPrivateUse(text)).toBe(true);
	});

	it('finds supplementary-plane private use too', () => {
		expect(containsPrivateUse('\u{F0000}')).toBe(true);
		expect(containsPrivateUse('\u{100001}')).toBe(true);
	});
});
