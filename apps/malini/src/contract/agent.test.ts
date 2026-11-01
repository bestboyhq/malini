import { describe, expect, it } from 'vitest';
import { contextWindowOf, DEFAULT_CONTEXT_WINDOW } from './agent';

describe('the context window a stored setting picks', () => {
	it('is 280K until the user picks one', () => {
		expect(contextWindowOf(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
		expect(contextWindowOf('')).toBe(DEFAULT_CONTEXT_WINDOW);
		expect(contextWindowOf('lots')).toBe(DEFAULT_CONTEXT_WINDOW);
	});

	it('keeps a pick on the slider and moves anything else to the nearest step on it', () => {
		expect(contextWindowOf('450000')).toBe(450_000);
		expect(contextWindowOf('284999')).toBe(280_000);
		expect(contextWindowOf('50000')).toBe(100_000);
		expect(contextWindowOf('2000000')).toBe(1_000_000);
	});
});
