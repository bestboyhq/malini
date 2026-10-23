import { describe, expect, it } from 'vitest';
import type { Routine } from './routine';
import { jobTriggerOf, ownRoutineOf, statusSteps } from './job-trigger';

function routine(id: string, when: string, steps: Routine['steps']): Routine {
	return {
		id,
		status: 'candidate',
		origin: 'user',
		label: id,
		when,
		steps,
		evidence: [],
		createdAt: '2026-10-23T00:00:00.000Z',
		updatedAt: '2026-10-23T00:00:00.000Z',
	};
}

const MERGED = 'on pull-requests:ship-changed where merged is set';

describe('jobTriggerOf', () => {
	const routines = [
		routine('chain', MERGED, [{ job: 'docs' }, { job: 'changelog' }]),
		routine('own', MERGED, [{ job: 'changelog' }]),
		routine('later', 'when a new workstream is created', [{ job: 'changelog' }]),
		routine('manual', 'when I run it', [{ job: 'docs' }]),
	];

	it('reads the trigger from the first routine that runs only that job', () => {
		expect(ownRoutineOf(routines, 'changelog')?.id).toBe('own');
		expect(jobTriggerOf(routines, 'changelog')).toEqual({ when: MERGED, status: 'candidate' });
	});

	it('has no trigger for a job that only runs by hand or inside a chain', () => {
		expect(ownRoutineOf(routines, 'docs')?.id).toBe('manual');
		expect(jobTriggerOf(routines, 'docs')).toBeNull();
		expect(jobTriggerOf(routines, 'missing')).toBeNull();
	});
});

describe('statusSteps', () => {
	it('walks the trust ladder one step at a time, in either direction', () => {
		expect(statusSteps('draft', 'routine')).toEqual(['promote', 'promote']);
		expect(statusSteps('routine', 'draft')).toEqual(['demote', 'demote']);
		expect(statusSteps('candidate', 'routine')).toEqual(['promote']);
		expect(statusSteps('candidate', 'candidate')).toEqual([]);
	});
});
