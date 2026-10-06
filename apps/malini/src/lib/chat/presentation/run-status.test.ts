import { describe, expect, it } from 'vitest';
import { deriveRunStatus, deriveTokenTicker, type DeriveRunStatusInput } from './run-status';

const NOW = 100_000;

function baseInput(overrides: Partial<DeriveRunStatusInput> = {}): DeriveRunStatusInput {
	return {
		isRunOpen: true,
		nowMs: NOW,
		...overrides,
	};
}

describe('deriveRunStatus', () => {
	it('renders nothing when no run is open', () => {
		expect(deriveRunStatus(baseInput({ isRunOpen: false, runStartedAtMs: NOW - 5_000 }))).toEqual({
			text: null,
		});
	});

	describe('the run clock', () => {
		it.each([
			[0, '0m, 0.0s'],
			[400, '0m, 0.4s'],
			[59_950, '0m, 60.0s'],
			[60_000, '1m, 0.0s'],
			[177_000, '2m, 57.0s'],
		])('shows %dms of an open run as %s', (elapsed, expected) => {
			expect(deriveRunStatus(baseInput({ runStartedAtMs: NOW - elapsed })).text).toBe(expected);
		});

		it('starts from zero when the run has not been stamped yet', () => {
			expect(deriveRunStatus(baseInput()).text).toBe('0m, 0.0s');
		});

		it('never runs backwards when the start mark is (implausibly) after now', () => {
			expect(deriveRunStatus(baseInput({ runStartedAtMs: NOW + 5_000 })).text).toBe('0m, 0.0s');
		});

		it('keeps running whatever else the run is doing', () => {
			expect(deriveRunStatus(baseInput({ runStartedAtMs: NOW - 12_000 })).text).toBe('0m, 12.0s');
		});
	});
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
