import { describe, expect, it } from 'vitest';
import { jobsView } from './jobs-view';

describe('jobsView', () => {
	it('opens Activity, Timeline and Recipes on their routes and the overview everywhere else', () => {
		expect(jobsView('/jobs/activity')).toBe('activity');
		expect(jobsView('/jobs/timeline')).toBe('timeline');
		expect(jobsView('/jobs/recipes')).toBe('recipes');
		expect(jobsView('/jobs')).toBe('overview');
		expect(jobsView('/jobs/[jobId]')).toBe('overview');
		expect(jobsView('/jobs/routines')).toBe('overview');
		expect(jobsView(null)).toBe('overview');
	});
});
