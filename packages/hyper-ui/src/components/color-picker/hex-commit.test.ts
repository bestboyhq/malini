import { describe, expect, it } from 'vitest';
import { isValidHex, normalizeHex } from './hex';

describe('hex commit rule', () => {
	it('does not accept a half-typed hex as a color', () => {
		expect(isValidHex('#12')).toBe(false);
		expect(isValidHex('#12345')).toBe(false);
		expect(isValidHex('#')).toBe(false);
	});

	it('accepts a complete six-digit hex in either case', () => {
		expect(isValidHex('#8b5cf6')).toBe(true);
		expect(isValidHex('#8B5CF6')).toBe(true);
	});

	it('drops characters that cannot appear in a hex and adds the missing hash', () => {
		expect(normalizeHex('8b5cf6')).toBe('#8B5CF6');
		expect(normalizeHex('#zz8b5c')).toBe('#8B5C');
	});

	it('stops at six digits so a longer paste cannot become a different color', () => {
		expect(normalizeHex('#8B5CF6AA')).toBe('#8B5CF6');
	});
});
