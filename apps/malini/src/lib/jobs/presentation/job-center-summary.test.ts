import { describe, expect, it } from 'vitest';
import { jobCenterSummary } from './job-center-summary';

const NOW = new Date(2026, 9, 26, 8).getTime();
const IDLE = { running: 0, queued: 0, needsYou: 0, finished: 0, nextAt: null };

describe('the job center summary', () => {
	it('counts what runs, waits in the queue and needs you', () => {
		expect(
			jobCenterSummary({ ...IDLE, running: 2, queued: 1, needsYou: 1, nextAt: NOW }, NOW),
		).toBe('2 running, 1 queued, 1 needs you');
		expect(jobCenterSummary({ ...IDLE, needsYou: 2 }, NOW)).toBe('2 need you');
	});

	it('says when the next scheduled job runs once nothing runs or waits', () => {
		const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime();
		expect(jobCenterSummary({ ...IDLE, finished: 3, nextAt: at(26, 9) }, NOW)).toBe(
			'next at 09:00 today',
		);
		expect(jobCenterSummary({ ...IDLE, nextAt: at(27, 9) }, NOW)).toBe('next at 09:00 tomorrow');
		expect(jobCenterSummary({ ...IDLE, nextAt: at(30, 9) }, NOW)).toBe('next Fri at 09:00');
	});

	it('falls back to recent jobs, then to being ready', () => {
		expect(jobCenterSummary({ ...IDLE, finished: 3 }, NOW)).toBe('3 finished recently');
		expect(jobCenterSummary(IDLE, NOW)).toBe('ready when you are');
	});
});
