import { describe, expect, it } from 'vitest';
import { jobCenterSummary } from './job-center-summary';

describe('the jobs gutter summary', () => {
	it('counts what runs, waits in the queue and needs you', () => {
		expect(jobCenterSummary({ running: 2, queued: 1, needsYou: 1 })).toBe(
			'2 running, 1 queued, 1 needs you',
		);
		expect(jobCenterSummary({ running: 0, queued: 0, needsYou: 2 })).toBe('2 need you');
		expect(jobCenterSummary({ running: 0, queued: 0, needsYou: 0 })).toBe('ready when you are');
	});
});
