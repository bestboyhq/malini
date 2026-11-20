import { describe, expect, it } from 'vitest';
import {
	addDays,
	dependencyState,
	initiativeProgress,
	isDay,
	rail,
	type Initiative,
	type InitiativeDependency,
	type StandingOf,
	type WorkstreamDot,
} from './initiative';

const dots: Readonly<Record<string, WorkstreamDot>> = {
	merged: 'merged',
	needs: 'needs',
	running: 'running',
	archived: 'archived',
};

const standingOf: StandingOf = (workstreamId) => {
	const dot = dots[workstreamId];
	return dot
		? {
				dot,
				label: dot,
				name: workstreamId,
				repositoryFullName: null,
				pullRequestNumber: null,
				open: true,
			}
		: null;
};

function dependency(workstreamIds: readonly string[], done = false): InitiativeDependency {
	return {
		id: workstreamIds.join('+') || 'none',
		title: 'Step',
		done,
		workstreams: workstreamIds.map((workstreamId) => ({ workstreamId, needs: null })),
	};
}

function initiative(
	dueOn: string | null,
	dependencies: readonly InitiativeDependency[],
): Initiative {
	return {
		id: `i-${dueOn}`,
		repositoryFullName: 'bestboyhq/grip',
		title: 'Outcome',
		dueOn,
		dependencies,
	};
}

describe('dependencyState', () => {
	it('is ticked by hand only while no workstream counts', () => {
		expect(dependencyState(dependency([]), standingOf)).toBe('todo');
		expect(dependencyState(dependency([], true), standingOf)).toBe('done');
		expect(dependencyState(dependency(['archived', 'gone'], true), standingOf)).toBe('done');
	});

	it('is merged once every counted workstream merges', () => {
		expect(dependencyState(dependency(['merged', 'archived']), standingOf)).toBe('merged');
		expect(dependencyState(dependency(['merged', 'running']), standingOf)).toBe('running');
		expect(dependencyState(dependency(['running', 'needs'], true), standingOf)).toBe('needs');
	});
});

describe('progress', () => {
	it('counts finished dependencies and the ones that need you', () => {
		const launch = initiative('2026-11-20', [
			dependency(['merged']),
			dependency(['needs']),
			dependency([], true),
		]);
		expect(initiativeProgress(launch, standingOf)).toEqual({
			done: 2,
			total: 3,
			needsYou: 1,
		});
	});
});

describe('rail', () => {
	it('runs from today through two more weeks, and labels each Monday', () => {
		const { earlier, weeks } = rail('2026-11-20', [], standingOf);
		expect(earlier).toEqual([]);
		expect(weeks.map((week) => week.label)).toEqual([null, 'Next week', 'Week of 30 Nov']);
		expect(weeks[0]?.days).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
		expect(weeks.at(-1)?.days.at(-1)).toBe('2026-12-06');
	});

	it('reaches the latest outcome and keeps only unfinished past ones', () => {
		const { earlier, weeks } = rail(
			'2026-11-20',
			[
				initiative('2026-12-24', []),
				initiative('2026-11-10', [dependency(['running'])]),
				initiative('2026-11-12', [dependency(['merged'])]),
			],
			standingOf,
		);
		expect(earlier).toEqual(['2026-11-10']);
		expect(weeks.at(-1)?.days.at(-1)).toBe('2026-12-27');
	});
});

describe('days', () => {
	it('crosses months and refuses dates that do not exist', () => {
		expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
		expect(isDay('2026-02-30')).toBe(false);
		expect(isDay('2026-11-20')).toBe(true);
	});
});
