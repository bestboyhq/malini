import { afterEach, describe, expect, it } from 'vitest';
import type { PullRequestShip } from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from './pull-request-ship.aggregate.svelte';

afterEach(() => pullRequestShipAggregate.reset());

function ship(workstreamId: string, overrides: Partial<PullRequestShip> = {}): PullRequestShip {
	return {
		workstreamId,
		phase: 'queued',
		step: null,
		keep: false,
		pullRequestNumber: 1,
		pullRequestUrl: null,
		needsYou: null,
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('the shipping aggregate', () => {
	it('keeps every change that arrived while the list was loading', () => {
		pullRequestShipAggregate.accept('stale', ship('stale'));
		pullRequestShipAggregate.beginLoad();
		pullRequestShipAggregate.accept('moved', ship('moved', { step: 'merging' }));
		pullRequestShipAggregate.accept('gone', null);

		pullRequestShipAggregate.finishLoad([
			ship('moved', { step: 'fixing-checks' }),
			ship('gone'),
			ship('listed'),
		]);

		expect(Object.keys(pullRequestShipAggregate.shipByWorkstream).sort()).toEqual([
			'listed',
			'moved',
		]);
		expect(pullRequestShipAggregate.shipFor('moved')?.step).toBe('merging');
	});

	it('ignores a state older than the one it holds', () => {
		pullRequestShipAggregate.accept(
			'ws',
			ship('ws', { step: 'merging', updatedAt: '2026-01-01T00:02:00.000Z' }),
		);
		pullRequestShipAggregate.accept(
			'ws',
			ship('ws', { step: 'fixing-checks', updatedAt: '2026-01-01T00:01:00.000Z' }),
		);

		expect(pullRequestShipAggregate.shipFor('ws')?.step).toBe('merging');
	});
});
