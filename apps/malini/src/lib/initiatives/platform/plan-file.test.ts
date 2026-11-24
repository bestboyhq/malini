import { describe, expect, it } from 'vitest';
import {
	commitMessage,
	mergePlan,
	parsePlanFile,
	planChanges,
	planFileText,
	type SharedDependency,
	type SharedOutcome,
	type SharedPlan,
} from './plan-file';

const NOTE = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

function outcome(id: string, change: Partial<SharedOutcome> = {}): SharedOutcome {
	return {
		id,
		title: id,
		dueOn: null,
		done: false,
		note: null,
		createdAt: '2026-11-23T10:00:00.000Z',
		dependencies: [],
		...change,
	};
}

function step(id: string, change: Partial<SharedDependency> = {}): SharedDependency {
	return { id, title: id, done: false, note: null, assignee: null, ...change };
}

describe('the plan file', () => {
	it('reads back what it writes, and drops what a hand edit broke', () => {
		const plan: SharedPlan = [
			outcome('launch', { dueOn: '2026-12-01', note: NOTE, dependencies: [step('name')] }),
			outcome('beta', { done: true }),
		];
		expect(parsePlanFile(planFileText(plan))).toEqual(plan);
		expect(parsePlanFile('{ not json')).toBeNull();
		expect(parsePlanFile('{"plan": []}')).toBeNull();
		expect(
			parsePlanFile(
				JSON.stringify({
					outcomes: [
						{ id: 'a b', title: 'Bad id' },
						{
							id: 'ok',
							title: '  Two\nlines  ',
							dueOn: '2026-02-30',
							done: 'yes',
							note: 'text',
							createdAt: 5,
						},
						{ id: 'OK', title: 'Same id' },
						{ id: 'next', title: '', dependencies: [] },
						{
							id: 'deps',
							title: 'Deps',
							dependencies: [
								{ id: 'ok', title: 'Taken id' },
								{ id: 'd', title: 'D', done: 'yes', assignee: 'not a login!' },
							],
						},
					],
				}),
			),
		).toEqual([
			outcome('ok', { title: 'Two lines', createdAt: '1970-01-01T00:00:00.000Z' }),
			outcome('deps', {
				title: 'Deps',
				createdAt: '1970-01-01T00:00:00.000Z',
				dependencies: [step('d', { title: 'D' })],
			}),
		]);
	});

	it('merges both sides field by field, keeps every add, and lets a delete win', () => {
		const base: SharedPlan = [
			outcome('a', { dependencies: [step('a1'), step('a2')] }),
			outcome('b'),
			outcome('e', { done: true }),
		];
		const remote: SharedPlan = [
			outcome('a', { title: 'A by them', dependencies: [step('a1', { done: true }), step('a2')] }),
			outcome('c'),
			outcome('e'),
		];
		const local: SharedPlan = [
			outcome('a', {
				title: 'A by us',
				dueOn: '2026-12-01',
				done: true,
				dependencies: [step('a1', { title: 'A1 by us' })],
			}),
			outcome('b', { title: 'B by us' }),
			outcome('d'),
			outcome('e', { done: true }),
		];
		expect(mergePlan(base, remote, local)).toEqual([
			outcome('a', {
				title: 'A by them',
				dueOn: '2026-12-01',
				done: true,
				dependencies: [step('a1', { title: 'A1 by us', done: true })],
			}),
			outcome('c'),
			outcome('e'),
			outcome('d'),
		]);
		expect(mergePlan(null, remote, local).map(({ id }) => id)).toEqual(['a', 'c', 'e', 'b', 'd']);
	});

	it('names each change in the commit message', () => {
		const before: SharedPlan = [
			outcome('a', { dependencies: [step('a1')] }),
			outcome('b'),
			outcome('e', { done: true }),
		];
		const after: SharedPlan = [
			outcome('a', {
				title: 'Launch',
				dueOn: '2026-12-01',
				done: true,
				note: NOTE,
				dependencies: [step('a1', { done: true })],
			}),
			outcome('e'),
			outcome('c'),
		];
		expect(commitMessage(planChanges(before, after))).toBe(
			[
				'Rename Launch and 7 more',
				'',
				'Rename Launch',
				'Move Launch',
				'Edit the note of Launch',
				'Close Launch',
				'Close a1',
				'Reopen e',
				'Add c',
				'Remove b',
				'',
			].join('\n'),
		);
		expect(commitMessage(planChanges(after, after))).toBe('Update the plan');
		expect(commitMessage([{ kind: 'added', title: 'c' }])).toBe('Add c\n');
	});
});
