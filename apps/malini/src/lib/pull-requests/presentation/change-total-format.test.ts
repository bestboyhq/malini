import { describe, expect, it } from 'vitest';

import { formatCompactChangeTotal } from './change-total-format';

describe('formatCompactChangeTotal', () => {
	it('keeps small totals exact and abbreviates larger totals with one decimal at most', () => {
		expect(formatCompactChangeTotal(0)).toBe('0');
		expect(formatCompactChangeTotal(42)).toBe('42');
		expect(formatCompactChangeTotal(999)).toBe('999');
		expect(formatCompactChangeTotal(1_000)).toBe('1k');
		expect(formatCompactChangeTotal(6_600)).toBe('6.6k');
		expect(formatCompactChangeTotal(10_000)).toBe('10k');
		expect(formatCompactChangeTotal(1_250_000)).toBe('1.3m');
	});

	it('promotes a rounded total to the next compact unit', () => {
		expect(formatCompactChangeTotal(999_949)).toBe('999.9k');
		expect(formatCompactChangeTotal(999_950)).toBe('1m');
	});
});
