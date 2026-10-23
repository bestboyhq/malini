import { describe, expect, it } from 'vitest';
import type { MaliniEditReview } from '$contract/approvals';
import { editReview, keepsCurrent, reviewedInput } from './edit-review';

const job: MaliniEditReview = {
	kind: 'job',
	current: {
		id: 'docs',
		name: 'Update docs',
		instructions: 'Read the diff.\nUpdate docs/.',
		model: 'opus',
		effort: 'high',
		runsIn: 'workstream',
		output: 'none',
		skills: [],
		builtin: 'update-docs',
		createdAt: '2026-10-23T00:00:00.000Z',
		updatedAt: '2026-10-23T00:00:00.000Z',
	},
};

const routine: MaliniEditReview = {
	kind: 'routine',
	current: {
		id: 'routine-1',
		status: 'routine',
		origin: 'user',
		label: 'Docs after merge',
		when: 'on pull-requests:ship-changed where merged is set',
		steps: [{ job: 'docs' }],
		evidence: [],
		createdAt: '2026-10-23T00:00:00.000Z',
		updatedAt: '2026-10-23T00:00:00.000Z',
	},
};

describe('editReview', () => {
	it('lists each field the agent changes, and the instructions as text to merge', () => {
		const edit = editReview(job, {
			id: 'docs',
			name: 'Update docs',
			model: 'sonnet',
			output: 'merge',
			instructions: 'Read the diff.\nUpdate docs/ and push to main.',
		});

		expect(edit.subject).toBe('job ‘Update docs’');
		expect(edit.changes.map(({ label, before, after }) => [label, before, after])).toEqual([
			['Model', 'opus', 'sonnet'],
			['When done', 'Leave the changes to you', 'Queue the merge'],
		]);
		expect(edit.text).toMatchObject({
			before: 'Read the diff.\nUpdate docs/.',
			after: 'Read the diff.\nUpdate docs/ and push to main.',
		});
	});

	it('saves each accepted change, the current value of each rejected one, and the merged text', () => {
		const edit = editReview(job, {
			id: 'docs',
			model: 'sonnet',
			output: 'merge',
			instructions: 'x',
		});

		expect(reviewedInput(job, edit, new Set(['output']), 'Mine')).toEqual({
			id: 'docs',
			model: 'sonnet',
			output: 'none',
			instructions: 'Mine',
		});
		expect(keepsCurrent(edit, new Set(['model', 'output']), 'Read the diff.\nUpdate docs/.')).toBe(
			true,
		);
		expect(keepsCurrent(edit, new Set(['model', 'output']), 'Mine')).toBe(false);
	});

	it('shows the jobs a routine runs by name and keeps their ids when a change is rejected', () => {
		const names: Record<string, string> = { docs: 'Update docs', lint: 'Lint' };
		const edit = editReview(
			routine,
			{ id: 'routine-1', when: 'when I run it', steps: ['docs', 'lint'] },
			(reference) => names[reference] ?? reference,
		);

		expect(edit.changes.map(({ label, before, after }) => [label, before, after])).toEqual([
			['When', 'on pull-requests:ship-changed where merged is set', 'when I run it'],
			['Runs', 'Update docs', 'Update docs → Lint'],
		]);
		expect(edit.text).toBeNull();
		expect(reviewedInput(routine, edit, new Set(['steps']), null)).toEqual({
			id: 'routine-1',
			when: 'when I run it',
			steps: ['docs'],
		});
	});
});
