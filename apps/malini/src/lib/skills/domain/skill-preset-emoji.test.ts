import { describe, expect, it } from 'vitest';
import { firstEmoji, isPresetEmoji, presetMark } from './skill-preset-emoji';

describe('preset emoji', () => {
	it('takes the first whole emoji out of typed text, joined sequences and flags included', () => {
		expect(firstEmoji('🛠️')).toBe('🛠️');
		expect(firstEmoji('ab 👩‍💻 🚀')).toBe('👩‍💻');
		expect(firstEmoji('🇵🇱')).toBe('🇵🇱');
		expect(firstEmoji('Builder')).toBeNull();
		expect(firstEmoji('')).toBeNull();
	});

	it('accepts exactly one emoji and nothing else', () => {
		expect(isPresetEmoji('🎨')).toBe(true);
		expect(isPresetEmoji('🎨🎨')).toBe(false);
		expect(isPresetEmoji('🎨 ')).toBe(false);
		expect(isPresetEmoji('B')).toBe(false);
		expect(isPresetEmoji(null)).toBe(false);
	});

	it('marks a preset with its emoji, or the first letter of its name', () => {
		expect(presetMark({ name: 'builder', emoji: '🛠️' })).toBe('🛠️');
		expect(presetMark({ name: 'builder', emoji: null })).toBe('B');
	});
});
