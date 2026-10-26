import { describe, expect, it } from 'vitest';
import type { PullRequestShip } from './pull-request-ship';
import { pullRequestBadge, type PullRequestState } from './pull-request-state';

function ship(overrides: Partial<PullRequestShip> = {}): PullRequestShip {
	return {
		workstreamId: 'ws-1',
		phase: 'draft',
		step: null,
		pullRequestNumber: 42,
		pullRequestUrl: 'https://github.com/acme/web/pull/42',
		needsYou: null,
		lastError: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('pullRequestBadge', () => {
	it('reads the pull request alone when shipping holds no row', () => {
		const badges = (['none', 'closed', 'draft', 'open', 'merged', 'unknown'] as const).map(
			(state: PullRequestState) => pullRequestBadge(null, state),
		);
		expect(badges).toEqual([
			{ phase: 'none', label: 'No pull request' },
			{ phase: 'none', label: 'Pull request closed' },
			{ phase: 'draft', label: 'Draft pull request' },
			{ phase: 'open', label: 'Pull request open' },
			{ phase: 'merged', label: 'Merged' },
			{ phase: 'unknown', label: null },
		]);
	});

	it('lets shipping speak for a queued or stuck workstream, whatever the read says', () => {
		for (const state of ['none', 'draft', 'open', 'unknown'] as const) {
			expect(pullRequestBadge(ship({ phase: 'queued' }), state)).toEqual({
				phase: 'queued',
				label: 'Merge queued',
			});
			expect(
				pullRequestBadge(
					ship({
						phase: 'needs-you',
						needsYou: { reason: 'merge-not-permitted', detail: '', jobRunId: null },
					}),
					state,
				),
			).toEqual({ phase: 'needs-you', label: 'Needs you · GitHub blocks the merge' });
		}
	});

	it('calls a draft row a draft until GitHub reports it open, merged or closed', () => {
		expect(pullRequestBadge(ship(), 'unknown')).toEqual({
			phase: 'draft',
			label: 'Draft pull request',
		});
		expect(
			pullRequestBadge(ship({ pullRequestNumber: null, step: 'opening-draft' }), 'none'),
		).toEqual({
			phase: 'draft',
			label: 'Opening draft',
		});
		expect(pullRequestBadge(ship(), 'open').phase).toBe('open');
		expect(pullRequestBadge(ship(), 'closed').phase).toBe('none');
	});
});
