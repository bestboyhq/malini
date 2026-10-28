import { describe, expect, it } from 'vitest';
import {
	mergeStoppedOnJob,
	needsYouDestination,
	pullRequestNeedsYouAnnouncement,
	type PullRequestShip,
} from './pull-request-ship';

function ship(overrides: Partial<PullRequestShip> = {}): PullRequestShip {
	return {
		workstreamId: 'ws-1',
		phase: 'queued',
		step: 'fixing-checks',
		keep: false,
		pullRequestNumber: 42,
		pullRequestUrl: 'https://github.com/acme/web/pull/42',
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

const REVIEWER = { reason: 'reply-to-reviewer', detail: '', jobRunId: null } as const;

describe('pullRequestNeedsYouAnnouncement', () => {
	it('announces a workstream that starts needing you, once', () => {
		const stuck = ship({ phase: 'needs-you', needsYou: REVIEWER });
		const change = { workstreamId: 'ws-1', ship: stuck, mergedPullRequestNumber: null };
		expect(pullRequestNeedsYouAnnouncement(ship(), change, 'Signal Arc')).toBe(
			'Signal Arc needs you · Reviewer needs a reply',
		);
		expect(pullRequestNeedsYouAnnouncement(null, change, 'Signal Arc')).toBe(
			'Signal Arc needs you · Reviewer needs a reply',
		);
		expect(pullRequestNeedsYouAnnouncement(stuck, change, 'Signal Arc')).toBeNull();
	});

	it('leaves a merge to the sidebar', () => {
		expect(
			pullRequestNeedsYouAnnouncement(
				ship({ step: 'archiving' }),
				{ workstreamId: 'ws-1', ship: null, mergedPullRequestNumber: 42 },
				'Signal Arc',
			),
		).toBeNull();
	});

	it('stays quiet while the queue only moves between steps', () => {
		expect(
			pullRequestNeedsYouAnnouncement(
				ship(),
				{ workstreamId: 'ws-1', ship: ship({ step: 'merging' }), mergedPullRequestNumber: null },
				'Signal Arc',
			),
		).toBeNull();
		expect(
			pullRequestNeedsYouAnnouncement(
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

describe('mergeStoppedOnJob', () => {
	it('names the job a merge stopped on, with why', () => {
		expect(
			mergeStoppedOnJob(
				ship({
					phase: 'needs-you',
					needsYou: {
						reason: 'fix-gave-up',
						detail: 'Fixing the checks did not work. Malini tried 3 times.',
						jobRunId: 'run-1',
					},
				}),
			),
		).toEqual({
			jobRunId: 'run-1',
			detail: 'Fixing the checks did not work. Malini tried 3 times.',
		});
		expect(
			mergeStoppedOnJob(
				ship({
					phase: 'needs-you',
					needsYou: { reason: 'fix-gave-up', detail: ' ', jobRunId: 'run-1' },
				}),
			)?.detail,
		).toBe('The agent could not fix the same failure after several attempts');
	});

	it('names no job for a stop without one, or a merge that moved on', () => {
		expect(mergeStoppedOnJob(ship({ phase: 'needs-you', needsYou: REVIEWER }))).toBeNull();
		expect(
			mergeStoppedOnJob(
				ship({
					phase: 'needs-you',
					needsYou: { reason: 'fix-gave-up', detail: '', jobRunId: null },
				}),
			),
		).toBeNull();
		expect(
			mergeStoppedOnJob(
				ship({
					phase: 'queued',
					needsYou: { reason: 'fix-gave-up', detail: '', jobRunId: 'run-1' },
				}),
			),
		).toBeNull();
		expect(mergeStoppedOnJob(null)).toBeNull();
	});
});
