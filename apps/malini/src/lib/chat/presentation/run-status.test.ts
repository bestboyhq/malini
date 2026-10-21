import { describe, expect, it } from 'vitest';
import { deriveTokenTicker, formatRunSeconds, tenthsPhaseDelayMs } from './run-status';

describe('the run clock', () => {
	it.each([
		[0, '0m, 0'],
		[400, '0m, 0'],
		[59_950, '0m, 59'],
		[60_000, '1m, 0'],
		[177_000, '2m, 57'],
	])('shows the whole seconds of %dms as %s', (elapsed, expected) => {
		expect(formatRunSeconds(elapsed)).toBe(expected);
	});

	it('never runs backwards when the start mark is (implausibly) after now', () => {
		expect(formatRunSeconds(-5_000)).toBe('0m, 0');
	});

	it.each([
		[1_000_350, 1_000_000],
		[1_002_350, 1_000_000],
		[999_650, 1_000_000],
	])(
		'phases the tenths so they roll over with the seconds of a run started at %d',
		(startedAt, origin) => {
			const delay = tenthsPhaseDelayMs(startedAt, origin);
			expect(delay).toBeLessThanOrEqual(0);
			expect(delay).toBeGreaterThan(-1_000);
			for (const now of [startedAt + 1_000, startedAt + 4_000, startedAt + 61_000]) {
				const tenthsActiveTimeMs = now - origin - delay;
				expect(((tenthsActiveTimeMs % 1_000) + 1_000) % 1_000).toBe(0);
			}
		},
	);
});

describe('deriveTokenTicker', () => {
	it('returns null when there is no usage snapshot', () => {
		expect(deriveTokenTicker(null)).toBeNull();
	});

	it('returns null when input and output tokens are both zero or missing', () => {
		expect(deriveTokenTicker({ inputTokens: null, outputTokens: null })).toBeNull();
		expect(deriveTokenTicker({ inputTokens: 0, outputTokens: 0 })).toBeNull();
	});

	it('formats a sub-1000 total as a plain count', () => {
		expect(deriveTokenTicker({ inputTokens: 150, outputTokens: 100 })).toBe('250 tokens');
	});

	it('formats a four-digit total with a one-decimal "k" suffix', () => {
		expect(deriveTokenTicker({ inputTokens: 1_000, outputTokens: 200 })).toBe('1.2k tokens');
	});

	it('drops the decimal once the "k" value reaches double digits', () => {
		expect(deriveTokenTicker({ inputTokens: 12_000, outputTokens: 3_000 })).toBe('15k tokens');
	});

	it('treats a missing side as zero (interim usage.updated snapshots may omit one field)', () => {
		expect(deriveTokenTicker({ inputTokens: 500, outputTokens: null })).toBe('500 tokens');
	});
});
