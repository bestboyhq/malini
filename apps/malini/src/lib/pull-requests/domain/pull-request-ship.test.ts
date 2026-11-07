import { describe, expect, it } from 'vitest';
import {
	mergeStoppedOnAutomation,
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
		checks: [],
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		waitsFor: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

const REVIEWER = { reason: 'reply-to-reviewer', detail: '', automationRunId: null } as const;

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
		expect(
			needsYouDestination({ reason: 'merge-not-permitted', detail: '', automationRunId: null }),
		).toBe('pull-request');
		expect(
			needsYouDestination({ reason: 'pull-request-closed', detail: '', automationRunId: null }),
		).toBe('pull-request');
		expect(
			needsYouDestination({ reason: 'fix-gave-up', detail: '', automationRunId: 'run-1' }),
		).toBe('automation');
		expect(needsYouDestination({ reason: 'fix-gave-up', detail: '', automationRunId: null })).toBe(
			'pull-request',
		);
		expect(
			needsYouDestination({ reason: 'github-reconnect', detail: '', automationRunId: null }),
		).toBe('repositories');
		expect(
			needsYouDestination({
				reason: 'operation-in-progress',
				detail: '',
				automationRunId: 'run-2',
			}),
		).toBe('automation');
		expect(
			needsYouDestination({ reason: 'operation-in-progress', detail: '', automationRunId: null }),
		).toBeNull();
	});
});

describe('mergeStoppedOnAutomation', () => {
	it('names the automation a merge stopped on, with why', () => {
		expect(
			mergeStoppedOnAutomation(
				ship({
					phase: 'needs-you',
					needsYou: {
						reason: 'fix-gave-up',
						detail: 'Fixing the checks did not work. Malini tried 3 times.',
						automationRunId: 'run-1',
					},
				}),
			),
		).toEqual({
			automationRunId: 'run-1',
			detail: 'Fixing the checks did not work. Malini tried 3 times.',
		});
		expect(
			mergeStoppedOnAutomation(
				ship({
					phase: 'needs-you',
					needsYou: { reason: 'fix-gave-up', detail: ' ', automationRunId: 'run-1' },
				}),
			)?.detail,
		).toBe('The agent could not fix the same failure after several attempts');
	});

	it('names no automation for a stop without one, or a merge that moved on', () => {
		expect(mergeStoppedOnAutomation(ship({ phase: 'needs-you', needsYou: REVIEWER }))).toBeNull();
		expect(
			mergeStoppedOnAutomation(
				ship({
					phase: 'needs-you',
					needsYou: { reason: 'fix-gave-up', detail: '', automationRunId: null },
				}),
			),
		).toBeNull();
		expect(
			mergeStoppedOnAutomation(
				ship({
					phase: 'queued',
					needsYou: { reason: 'fix-gave-up', detail: '', automationRunId: 'run-1' },
				}),
			),
		).toBeNull();
		expect(mergeStoppedOnAutomation(null)).toBeNull();
	});
});
