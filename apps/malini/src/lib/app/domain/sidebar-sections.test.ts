import { describe, expect, it } from 'vitest';
import { daySection, statusSection, type StatusInput } from './sidebar-sections';

const NOW = new Date(2026, 9, 25, 9, 30).getTime();
const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime();

function status(change: Partial<StatusInput>): string {
	return statusSection({ dot: 'idle', pullRequest: 'none', activeAt: NOW, now: NOW, ...change });
}

describe('statusSection', () => {
	it('puts work that waits on you or failed first, then running work', () => {
		expect(status({ dot: 'needs' })).toBe('needs-you');
		expect(status({ dot: 'blocked', pullRequest: 'needs-you' })).toBe('needs-you');
		expect(status({ dot: 'failed', activeAt: at(1, 0) })).toBe('needs-you');
		expect(status({ dot: 'running' })).toBe('in-progress');
		expect(status({ dot: 'merged' })).toBe('merged');
	});

	it('tells a pull request in review from idle work, and both from stale work', () => {
		expect(status({ pullRequest: 'draft' })).toBe('in-review');
		expect(status({ pullRequest: 'open', activeAt: at(18, 23) })).toBe('in-review');
		expect(status({})).toBe('idle');
		expect(status({ activeAt: at(17, 23) })).toBe('stale');
		expect(status({ pullRequest: 'open', activeAt: at(17, 23) })).toBe('stale');
	});
});

describe('daySection', () => {
	it('splits by the local calendar day of the last activity', () => {
		expect(daySection(at(25, 0), NOW)).toBe('today');
		expect(daySection(at(24, 23), NOW)).toBe('yesterday');
		expect(daySection(at(24, 0), NOW)).toBe('yesterday');
		expect(daySection(at(23, 23), NOW)).toBe('older');
		expect(daySection(0, NOW)).toBe('older');
	});
});
