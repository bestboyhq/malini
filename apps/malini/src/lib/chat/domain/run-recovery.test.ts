import { describe, expect, it } from 'vitest';
import { runResumeAt } from './run-recovery';

const NOW = Date.parse('2026-10-27T12:00:00.000Z');

describe('runResumeAt', () => {
	it('waits out a usage limit until it resets, however many tries came before', () => {
		const failure = { kind: 'usage-limit', resetsAt: '2026-10-27T14:31:13.000Z' } as const;

		expect(runResumeAt(failure, 0, NOW)).toBe('2026-10-27T14:31:18.000Z');
		expect(runResumeAt(failure, 9, NOW)).toBe('2026-10-27T14:31:18.000Z');
	});

	it('backs off a usage limit whose reset already passed like a rate limit', () => {
		expect(runResumeAt({ kind: 'usage-limit', resetsAt: '2026-10-27T11:00:00.000Z' }, 0, NOW)).toBe(
			'2026-10-27T12:01:00.000Z',
		);
		expect(runResumeAt({ kind: 'usage-limit' }, 1, NOW)).toBe('2026-10-27T12:02:00.000Z');
	});

	it('backs off an outage 1, 2, 4, 8, 15 and 30 minutes, then gives up', () => {
		const waits = [0, 1, 2, 3, 4, 5, 6].map((retries) =>
			runResumeAt({ kind: 'overloaded', status: 529 }, retries, NOW),
		);

		expect(waits).toEqual([
			'2026-10-27T12:01:00.000Z',
			'2026-10-27T12:02:00.000Z',
			'2026-10-27T12:04:00.000Z',
			'2026-10-27T12:08:00.000Z',
			'2026-10-27T12:15:00.000Z',
			'2026-10-27T12:30:00.000Z',
			null,
		]);
		expect(runResumeAt({ kind: 'network' }, 0, NOW)).toBe('2026-10-27T12:01:00.000Z');
		expect(runResumeAt({ kind: 'rate-limit' }, 0, NOW)).toBe('2026-10-27T12:01:00.000Z');
		expect(runResumeAt({ kind: 'server-error' }, 0, NOW)).toBe('2026-10-27T12:01:00.000Z');
	});

	it('tries an unknown error once more after a minute', () => {
		expect(runResumeAt({ kind: 'unknown' }, 0, NOW)).toBe('2026-10-27T12:01:00.000Z');
		expect(runResumeAt({ kind: 'unknown' }, 1, NOW)).toBeNull();
	});

	it('leaves what only you can fix to you', () => {
		for (const kind of ['sign-in', 'billing', 'model', 'request'] as const) {
			expect(runResumeAt({ kind }, 0, NOW)).toBeNull();
		}
	});
});
