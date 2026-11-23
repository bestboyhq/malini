import { describe, expect, it } from 'vitest';
import type { Initiative, InitiativeDependency } from '$contract/initiatives';
import type { StandingOf } from './initiative';
import {
	dueLabel,
	nextOutcome,
	outcomesFor,
	planDays,
	planOrder,
	remoteChangeLine,
	servesWorkstream,
	syncedLabel,
} from './plan';

const TODAY = '2026-11-22';

const standingOf: StandingOf = () => null;

function dependency(done: boolean, workstreamIds: readonly string[] = []): InitiativeDependency {
	return {
		id: `d-${done}-${workstreamIds.join('+')}`,
		title: 'Step',
		done,
		note: null,
		workstreams: workstreamIds.map((workstreamId) => ({ workstreamId, needs: null })),
		assignee: null,
	};
}

function outcome(
	id: string,
	dueOn: string | null,
	dependencies: readonly InitiativeDependency[] = [dependency(false)],
): Initiative {
	return {
		id,
		repositoryFullName: 'acme/rocket',
		title: id,
		dueOn,
		note: null,
		dependencies,
	};
}

const ids = (list: readonly Initiative[]): string[] => list.map(({ id }) => id);

describe('planOrder', () => {
	it('puts the earliest due date first and outcomes with no date last, keeping ties in place', () => {
		const list = [
			outcome('lag', null),
			outcome('season', '2027-01-01'),
			outcome('tournament', '2026-10-30'),
			outcome('extra', null),
			outcome('creators', '2026-12-11'),
			outcome('servers', '2026-12-11'),
		];
		expect(ids(planOrder(list))).toEqual([
			'tournament',
			'creators',
			'servers',
			'season',
			'lag',
			'extra',
		]);
	});
});

describe('planDays', () => {
	it('groups outcomes under the days that have any, in date order, with no date last', () => {
		const list = [
			outcome('lag', null),
			outcome('servers', '2026-12-11'),
			outcome('tournament', '2026-10-30'),
			outcome('creators', '2026-12-11'),
		];
		expect(planDays(list).map(({ day, outcomes }) => [day, ids(outcomes)])).toEqual([
			['2026-10-30', ['tournament']],
			['2026-12-11', ['servers', 'creators']],
			[null, ['lag']],
		]);
	});
});

describe('dueLabel', () => {
	it('counts the days an open outcome is late', () => {
		expect(dueLabel('2026-10-30', TODAY, false)).toEqual({ text: '23 d late', late: true });
	});

	it('shows the day for an outcome that is due, today or done late', () => {
		expect(dueLabel('2026-12-04', TODAY, false)).toEqual({ text: '4 Dec', late: false });
		expect(dueLabel(TODAY, TODAY, false)).toEqual({ text: '22 Nov', late: false });
		expect(dueLabel('2026-10-30', TODAY, true)).toEqual({ text: '30 Oct', late: false });
	});

	it('says when there is no date', () => {
		expect(dueLabel(null, TODAY, false)).toEqual({ text: 'No date', late: false });
	});

	it('counts whole days across a daylight saving change', () => {
		expect(dueLabel('2026-03-01', '2026-04-01', false).text).toBe('31 d late');
	});
});

describe('which outcomes fit a size', () => {
	const late = outcome('late', '2026-10-30');
	const done = outcome('done', '2026-11-25', [dependency(true)]);
	const soon = outcome('soon', '2026-12-04');
	const later = outcome('later', '2026-12-11');
	const last = outcome('last', '2027-01-01');
	const undated = outcome('undated', null);
	const ordered = planOrder([undated, last, later, soon, done, late]);

	it('shows the next open outcome that is still due when small', () => {
		expect(ids(outcomesFor('small', ordered, TODAY, standingOf))).toEqual(['soon']);
	});

	it('shows the first three open outcomes when medium', () => {
		expect(ids(outcomesFor('medium', ordered, TODAY, standingOf))).toEqual([
			'late',
			'soon',
			'later',
		]);
	});

	it('shows every outcome when large', () => {
		expect(ids(outcomesFor('large', ordered, TODAY, standingOf))).toEqual([
			'late',
			'done',
			'soon',
			'later',
			'last',
			'undated',
		]);
	});

	it('falls back to a late or undated outcome when nothing is still due', () => {
		expect(nextOutcome(planOrder([undated, late]), TODAY, standingOf)?.id).toBe('late');
		expect(nextOutcome([undated], TODAY, standingOf)?.id).toBe('undated');
		expect(outcomesFor('small', [done], TODAY, standingOf)).toEqual([]);
	});
});

describe('servesWorkstream', () => {
	it('is true only for a dependency linked to the workstream', () => {
		const linked = dependency(false, ['ws-1', 'ws-2']);
		expect(servesWorkstream(linked, 'ws-2')).toBe(true);
		expect(servesWorkstream(linked, 'ws-3')).toBe(false);
		expect(servesWorkstream(linked, null)).toBe(false);
	});
});

describe('syncedLabel', () => {
	const at = '2026-11-22T10:00:00.000Z';
	const after = (seconds: number): number => Date.parse(at) + seconds * 1000;

	it('counts up from the last sync', () => {
		expect(syncedLabel(at, after(1))).toBe('Shared just now');
		expect(syncedLabel(at, after(3))).toBe('Shared 3 s ago');
		expect(syncedLabel(at, after(125))).toBe('Shared 2 min ago');
		expect(syncedLabel(at, after(7200))).toBe('Shared 2 h ago');
		expect(syncedLabel(at, after(3 * 86_400))).toBe('Shared 3 d ago');
	});

	it('says when it never synced', () => {
		expect(syncedLabel(null, after(0))).toBe('Not shared yet');
	});
});

describe('remoteChangeLine', () => {
	it('names who changed what', () => {
		expect(remoteChangeLine({ actor: 'Robin', kind: 'closed', title: 'Pick a name' })).toBe(
			'Robin closed Pick a name',
		);
		expect(remoteChangeLine({ actor: null, kind: 'dated', title: 'Season 1 opens' })).toBe(
			'Someone moved Season 1 opens',
		);
	});
});
