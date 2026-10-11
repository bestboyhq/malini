import { describe, expect, it } from 'vitest';
import {
	needsYouDestination,
	pullRequestShipAnnouncement,
	type PullRequestShip,
} from './pull-request-ship';

function ship(overrides: Partial<PullRequestShip> = {}): PullRequestShip {
	return {
		workstreamId: 'ws-1',
		phase: 'queued',
		step: 'fixing-checks',
		pullRequestNumber: 42,
		pullRequestUrl: 'https://github.com/acme/web/pull/42',
		needsYou: null,
		lastError: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

const REVIEWER = { reason: 'reply-to-reviewer', detail: '', jobRunId: null } as const;

describe('pullRequestShipAnnouncement', () => {
	it('announces a workstream that starts needing you, once', () => {
		const stuck = ship({ phase: 'needs-you', needsYou: REVIEWER });
		const change = { workstreamId: 'ws-1', ship: stuck, mergedPullRequestNumber: null };
		expect(pullRequestShipAnnouncement(ship(), change, 'Signal Arc')).toEqual({
			level: 'warning',
			message: 'Signal Arc needs you · Reply to reviewer',
		});
		expect(pullRequestShipAnnouncement(null, change, 'Signal Arc')?.level).toBe('warning');
		expect(pullRequestShipAnnouncement(stuck, change, 'Signal Arc')).toBeNull();
	});

	it('announces a merge and the archive that follows it', () => {
		expect(
			pullRequestShipAnnouncement(
				ship({ step: 'archiving' }),
				{ workstreamId: 'ws-1', ship: null, mergedPullRequestNumber: 42 },
				'Signal Arc',
			),
		).toEqual({ level: 'success', message: 'Merged #42 · Signal Arc archived' });
	});

	it('stays quiet while the queue only moves between steps', () => {
		expect(
			pullRequestShipAnnouncement(
				ship(),
				{ workstreamId: 'ws-1', ship: ship({ step: 'merging' }), mergedPullRequestNumber: null },
				'Signal Arc',
			),
		).toBeNull();
		expect(
			pullRequestShipAnnouncement(
				ship(),
				{ workstreamId: 'ws-1', ship: null, mergedPullRequestNumber: null },
				'Signal Arc',
			),
		).toBeNull();
	});
});

describe('needsYouDestination', () => {
	it('sends each reason to the place that resolves it', () => {
		expect(needsYouDestination(REVIEWER)).toBe('pull-request');
		expect(needsYouDestination({ reason: 'merge-not-permitted', detail: '', jobRunId: null })).toBe(
			'pull-request',
		);
		expect(needsYouDestination({ reason: 'pull-request-closed', detail: '', jobRunId: null })).toBe(
			'pull-request',
		);
		expect(needsYouDestination({ reason: 'fix-gave-up', detail: '', jobRunId: 'run-1' })).toBe(
			'job',
		);
		expect(needsYouDestination({ reason: 'fix-gave-up', detail: '', jobRunId: null })).toBe(
			'pull-request',
		);
		expect(needsYouDestination({ reason: 'github-reconnect', detail: '', jobRunId: null })).toBe(
			'repositories',
		);
		expect(
			needsYouDestination({ reason: 'operation-in-progress', detail: '', jobRunId: 'run-2' }),
		).toBe('job');
		expect(
			needsYouDestination({ reason: 'operation-in-progress', detail: '', jobRunId: null }),
		).toBeNull();
	});
});
