import { describe, expect, it } from 'vitest';
import type { MaliniEditReview } from '$contract/approvals';
import type { JobDefinitionRecord } from '$contract/jobs';
import { editReview, keepsCurrent, reviewedInput } from './edit-review';

function job(changes: Partial<JobDefinitionRecord> = {}): MaliniEditReview {
	return {
		kind: 'job',
		current: {
			id: 'docs',
			name: 'Update docs',
			instructions: 'Read the diff.\nUpdate docs/.',
			provider: 'claude',
			model: 'opus',
			effort: 'high',
			runsIn: 'workstream',
			skills: [],
			builtin: 'update-docs',
			trigger: null,
			thenJobId: 'draft',
			createdAt: '2026-10-23T00:00:00.000Z',
			updatedAt: '2026-10-23T00:00:00.000Z',
			...changes,
		},
	};
}

const names: Record<string, string> = { draft: 'Open draft', merge: 'Merge' };
const jobName = (reference: string): string => names[reference] ?? reference;

describe('editReview', () => {
	it('lists each field the agent changes, and the instructions as text to merge', () => {
		const edit = editReview(
			job(),
			{
				id: 'docs',
				name: 'Update docs',
				model: 'sonnet',
				then: 'merge',
				instructions: 'Read the diff.\nUpdate docs/ and push to main.',
			},
			jobName,
		);

		expect(edit.subject).toBe('job ‘Update docs’');
		expect(edit.changes.map(({ label, before, after }) => [label, before, after])).toEqual([
			['Model', 'opus', 'sonnet'],
			['Then', 'Open draft', 'Merge'],
		]);
		expect(edit.text).toMatchObject({
			before: 'Read the diff.\nUpdate docs/.',
			after: 'Read the diff.\nUpdate docs/ and push to main.',
		});
	});

	it('saves each accepted change, the current value of each rejected one, and the merged text', () => {
		const edit = editReview(job(), {
			id: 'docs',
			model: 'sonnet',
			then: 'Merge',
			instructions: 'x',
		});

		expect(reviewedInput(job(), edit, new Set(['then']), 'Mine')).toEqual({
			id: 'docs',
			model: 'sonnet',
			then: 'draft',
			instructions: 'Mine',
		});
		expect(keepsCurrent(edit, new Set(['model', 'then']), 'Read the diff.\nUpdate docs/.')).toBe(
			true,
		);
		expect(keepsCurrent(edit, new Set(['model', 'then']), 'Mine')).toBe(false);
	});

	it('shows the Then by name, and no change when the agent names the job it already has', () => {
		const edit = editReview(job(), { id: 'docs', then: 'Open draft' }, jobName);
		expect(edit.changes).toEqual([]);
		expect(
			editReview(job(), { id: 'docs', then: null }, jobName).changes.map(
				({ label, before, after }) => [label, before, after],
			),
		).toEqual([['Then', 'Open draft', 'Nothing']]);
	});

	it('shows how a new trigger runs, decided with its When, and never saves the run mode', () => {
		const added = editReview(job(), { id: 'docs', when: 'on jobs:suggested' });
		expect(
			added.changes.map(({ label, before, after, follows }) => [label, before, after, follows]),
		).toEqual([
			['When', 'Only when you run it', 'on jobs:suggested', null],
			['Runs', 'Only when you run it', 'Off', 'when'],
		]);
		expect(reviewedInput(job(), added, new Set(), null)).toEqual({
			id: 'docs',
			when: 'on jobs:suggested',
		});
		expect(keepsCurrent(added, new Set(['when']), null)).toBe(true);

		const auto = job({ trigger: { when: 'on jobs:suggested', mode: 'auto' } });
		const moved = editReview(auto, { id: 'docs', when: 'on jobs:run-changed' });
		expect(moved.changes.map(({ label }) => label)).toEqual(['When']);
		const cleared = editReview(auto, { id: 'docs', when: null });
		expect(cleared.changes.map(({ label, before, after }) => [label, before, after])).toEqual([
			['When', 'on jobs:suggested', 'Only when you run it'],
			['Runs', 'On its own', 'Only when you run it'],
		]);
		expect(reviewedInput(auto, cleared, new Set(['when']), null)).toEqual({
			id: 'docs',
			when: 'on jobs:suggested',
		});
	});
});
