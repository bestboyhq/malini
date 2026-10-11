import { describe, expect, it } from 'vitest';
import type { ShipNeedsYou, ShipNeedsYouReason, ShipStep } from '$contract/pull-requests';
import type {
	PullRequestAvailability,
	PullRequestMenuItemId,
	PullRequestTopBar,
} from './pull-request-action';
import type { PullRequestShip } from './pull-request-ship';
import { pullRequestTopBar } from './pull-request-top-bar';
import type { RepositorySurface, SurfacePullRequest } from './repository-surface';

function pullRequest(overrides: Partial<SurfacePullRequest> = {}): SurfacePullRequest {
	return {
		state: 'open',
		number: 42,
		url: 'https://github.com/acme/web/pull/42',
		headSha: 'head-42',
		githubLagsPush: false,
		mergeable: true,
		mergeableState: 'clean',
		behindBase: 0,
		checks: 'success',
		checksHeadline: 'Checks passed',
		checkItems: [],
		reviewDecision: null,
		unresolvedReviewThreadCount: 0,
		reviewStatusUnavailable: false,
		viewerCanMerge: true,
		mergeReadiness: 'ready',
		mergeMethod: 'squash',
		...overrides,
	};
}

const NO_PULL_REQUEST = pullRequest({ state: 'not_open', number: null, url: null });

function surface(overrides: Partial<RepositorySurface> = {}): RepositorySurface {
	return {
		status: 'ready',
		workstreamId: 'ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		changedFiles: 2,
		ahead: 1,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		pullRequest: NO_PULL_REQUEST,
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		github: null,
		...overrides,
	};
}

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

function needsYou(reason: ShipNeedsYouReason, overrides: Partial<ShipNeedsYou> = {}): ShipNeedsYou {
	return { reason, detail: '', jobRunId: null, ...overrides };
}

function topBar(
	shipState: PullRequestShip | null,
	read: RepositorySurface | null,
	availability: PullRequestAvailability = 'ready',
): PullRequestTopBar {
	return pullRequestTopBar(shipState, read, availability);
}

function menu(bar: PullRequestTopBar): readonly PullRequestMenuItemId[] {
	return bar.menu.map(({ id }) => id);
}

describe('the top bar before a pull request exists', () => {
	it('offers Open draft when the workstream has work to ship', () => {
		expect(topBar(null, surface({ dirtyPaths: ['src/a.ts'], changedFiles: 0 })).action).toEqual({
			kind: 'open-draft',
			label: 'Open draft',
			ariaLabel: 'Open a draft pull request',
			tooltip: 'Commit and push this workstream, then open a draft pull request',
			disabled: false,
			busy: false,
			tone: 'primary',
		});
		expect(topBar(null, surface({ changedFiles: 3 })).action?.label).toBe('Open draft');
	});

	it('shows no button when there is nothing to ship', () => {
		const bar = topBar(null, surface({ changedFiles: 0, dirtyPaths: [], ahead: 0 }));
		expect(bar.action).toBeNull();
		expect(bar.menu).toEqual([]);
	});

	it('offers a replacement draft once the previous pull request was closed', () => {
		const action = topBar(null, surface({ pullRequest: pullRequest({ state: 'closed' }) })).action;
		expect(action).toMatchObject({
			kind: 'open-draft',
			ariaLabel: 'Open a replacement draft pull request',
		});
		expect(action?.tooltip).toContain('The previous pull request is closed');
	});

	it('says why the last draft attempt failed', () => {
		const action = topBar(
			ship({ pullRequestNumber: null, pullRequestUrl: null, lastError: 'push rejected' }),
			surface(),
		).action;
		expect(action?.kind).toBe('open-draft');
		expect(action?.tooltip).toBe('Opening the draft failed: push rejected. Try again');
	});

	it.each<[ShipStep, string]>([
		['waiting-for-agent', 'Waiting for the agent…'],
		['opening-draft', 'Opening draft…'],
		['pushing', 'Opening draft…'],
	])('shows %s as a busy draft before the pull request exists', (step, label) => {
		const action = topBar(
			ship({ step, pullRequestNumber: null, pullRequestUrl: null }),
			null,
		).action;
		expect(action).toMatchObject({
			kind: 'opening-draft',
			label,
			ariaLabel: label,
			busy: true,
			tone: 'primary',
		});
	});

	it('says why the draft is still opening while malini retries it', () => {
		const action = topBar(
			ship({
				step: 'opening-draft',
				pullRequestNumber: null,
				lastError: "Couldn't reach github.com.",
			}),
			null,
		).action;
		expect(action?.tooltip).toBe(
			"Opening the draft failed and malini retries it: Couldn't reach github.com.",
		);
	});

	it('says why the last idle push failed while malini retries it', () => {
		const action = topBar(
			ship({ step: 'pushing', lastError: "Couldn't reach github.com." }),
			surface(),
		).action;
		expect(action?.kind).toBe('queue-merge');
		expect(action?.tooltip).toBe(
			"Pushing the latest work failed and malini retries it: Couldn't reach github.com.",
		);
	});

	it('shows nothing while the first read of the workstream is still pending', () => {
		expect(topBar(null, null).action).toBeNull();
		expect(topBar(null, surface({ status: 'idle' })).action).toBeNull();
		expect(
			topBar(
				null,
				surface({
					status: 'loading',
					pullRequestRefreshStatus: 'loading',
					pullRequestRefreshedAt: null,
				}),
			).action,
		).toBeNull();
	});
});

describe('the top bar once a pull request exists', () => {
	it('offers Queue merge for an open or draft pull request malini did not open', () => {
		for (const state of ['open', 'draft'] as const) {
			expect(topBar(null, surface({ pullRequest: pullRequest({ state }) })).action).toEqual({
				kind: 'queue-merge',
				label: 'Queue merge',
				ariaLabel: 'Queue merge for pull request #42',
				tooltip:
					'Malini marks the pull request ready, keeps it up to date and its checks green, and merges it once GitHub allows',
				disabled: false,
				busy: false,
				tone: 'primary',
			});
		}
	});

	it('offers Queue merge from the draft phase, even before the workstream was read', () => {
		expect(topBar(ship(), null).action?.kind).toBe('queue-merge');
		expect(topBar(ship(), surface({ pullRequest: NO_PULL_REQUEST })).action?.kind).toBe(
			'queue-merge',
		);
		expect(topBar(ship({ step: 'pushing' }), surface()).action?.kind).toBe('queue-merge');
	});

	it('keeps Queue merge whatever GitHub says about checks, review or conflicts', () => {
		const blocked = pullRequest({
			checks: 'failed',
			mergeable: false,
			mergeableState: 'dirty',
			reviewDecision: 'changes_requested',
			unresolvedReviewThreadCount: 3,
		});
		expect(topBar(null, surface({ pullRequest: blocked, behind: 4 })).action?.kind).toBe(
			'queue-merge',
		);
	});

	it('trusts a closed pull request over a stale draft row', () => {
		expect(
			topBar(ship(), surface({ pullRequest: pullRequest({ state: 'closed' }) })).action?.kind,
		).toBe('open-draft');
	});

	it('shows no button for a pull request merged outside the queue', () => {
		const bar = topBar(null, surface({ pullRequest: pullRequest({ state: 'merged' }) }));
		expect(bar.action).toBeNull();
		expect(menu(bar)).toEqual(['refresh']);
	});
});

describe('the top bar while the merge is queued', () => {
	it.each<[ShipStep, string]>([
		['waiting-for-agent', 'Waiting for the agent'],
		['pushing', 'Pushing'],
		['marking-ready', 'Marking ready'],
		['updating-branch', 'Updating branch'],
		['resolving-conflicts', 'Resolving conflicts'],
		['fixing-checks', 'Fixing checks'],
		['addressing-review', 'Addressing review'],
		['waiting-for-checks', 'Waiting for checks'],
		['waiting-for-review', 'Waiting for review'],
		['waiting-for-github', 'Waiting for GitHub'],
		['waiting-for-turn', 'Waiting for its turn'],
		['merging', 'Merging…'],
		['archiving', 'Archiving…'],
	])('names the %s step', (step, label) => {
		const action = topBar(ship({ phase: 'queued', step }), surface()).action;
		expect(action).toMatchObject({
			kind: 'queued',
			label: `Queued · ${label}`,
			ariaLabel: `Merge queued · ${label}`,
			busy: true,
			disabled: false,
			tone: 'secondary',
		});
		expect(action?.tooltip).toMatch(/\. Cancel the merge from the pull request menu$/u);
	});

	it('explains the step it waits on', () => {
		expect(
			topBar(ship({ phase: 'queued', step: 'waiting-for-review' }), null).action?.tooltip,
		).toBe(
			'Malini waits for a required approval on GitHub. Cancel the merge from the pull request menu',
		);
	});

	it('reads as plain Queued between steps', () => {
		expect(topBar(ship({ phase: 'queued' }), null).action).toMatchObject({
			label: 'Queued',
			ariaLabel: 'Merge queued',
		});
	});

	it('shows the last error while it retries', () => {
		expect(
			topBar(ship({ phase: 'queued', step: 'merging', lastError: 'GitHub answered 502' }), null)
				.action?.tooltip,
		).toBe(
			'Malini is merging the pull request. The last attempt failed and malini retries it: GitHub answered 502',
		);
	});

	it('wins over every setup blocker and worktree state', () => {
		const rebasing = surface({ operationInProgress: 'rebase' });
		for (const availability of ['github-unavailable', 'extension-unavailable'] as const) {
			expect(topBar(ship({ phase: 'queued' }), rebasing, availability).action?.kind).toBe('queued');
		}
	});

	it('offers Cancel merge behind a confirmation, plus Refresh', () => {
		const bar = topBar(ship({ phase: 'queued' }), surface({ pullRequest: pullRequest() }));
		expect(bar.menu).toEqual([
			{ id: 'cancel-merge', label: 'Cancel merge', confirmLabel: 'Confirm cancel' },
			{ id: 'refresh', label: 'Refresh', confirmLabel: null },
		]);
	});

	it('leaves Refresh out until the workstream was read', () => {
		expect(menu(topBar(ship({ phase: 'queued' }), null))).toEqual(['cancel-merge']);
	});
});

describe('the top bar when the merge needs you', () => {
	it.each<[ShipNeedsYouReason, string]>([
		['reply-to-reviewer', 'Reply to reviewer'],
		['fix-gave-up', 'Fix gave up'],
		['merge-not-permitted', "Can't merge"],
		['pull-request-closed', 'PR closed'],
		['github-reconnect', 'Reconnect GitHub'],
	])('names %s', (reason, label) => {
		const action = topBar(
			ship({ phase: 'needs-you', needsYou: needsYou(reason) }),
			surface(),
		).action;
		expect(action).toMatchObject({
			kind: 'needs-you',
			label,
			ariaLabel: `Needs you · ${label}`,
			disabled: false,
			busy: false,
			tone: 'primary',
		});
	});

	it('names the git operation to finish', () => {
		const stopped = ship({ phase: 'needs-you', needsYou: needsYou('operation-in-progress') });
		expect(topBar(stopped, surface({ operationInProgress: 'rebase' })).action?.label).toBe(
			'Finish the rebase',
		);
		expect(topBar(stopped, null).action?.label).toBe('Finish the operation');
	});

	it('opens the pull request on GitHub for a reviewer, a refused merge or a closed pull request', () => {
		for (const reason of [
			'reply-to-reviewer',
			'merge-not-permitted',
			'pull-request-closed',
		] as const) {
			const action = topBar(
				ship({
					phase: 'needs-you',
					needsYou: needsYou(reason, { detail: 'Octo asked for tests' }),
				}),
				null,
			).action;
			expect(action?.tooltip).toBe('Octo asked for tests. Opens the pull request on GitHub.');
			expect(action?.disabled).toBe(false);
		}
	});

	it('cannot open a pull request it has no address for', () => {
		const action = topBar(
			ship({
				phase: 'needs-you',
				pullRequestUrl: null,
				needsYou: needsYou('reply-to-reviewer'),
			}),
			null,
		).action;
		expect(action?.disabled).toBe(true);
		expect(action?.tooltip).toBe(
			'A reviewer requested changes, and only you can answer them. Retry or cancel the merge from the pull request menu.',
		);
	});

	it('opens the transcript of a fix that gave up, or the pull request when there is none', () => {
		expect(
			topBar(
				ship({ phase: 'needs-you', needsYou: needsYou('fix-gave-up', { jobRunId: 'run-1' }) }),
				null,
			).action?.tooltip,
		).toBe(
			'The agent could not fix the same failure after several attempts. Opens the transcript of the job that stopped.',
		);
		expect(
			topBar(ship({ phase: 'needs-you', needsYou: needsYou('fix-gave-up') }), null).action?.tooltip,
		).toContain('Opens the pull request on GitHub.');
	});

	it('sends a lost GitHub sign-in to the repositories page', () => {
		expect(
			topBar(ship({ phase: 'needs-you', needsYou: needsYou('github-reconnect') }), null).action
				?.tooltip,
		).toBe(
			'GitHub no longer accepts the stored sign-in. Opens the repositories page to sign in with GitHub again.',
		);
	});

	it('leaves an unfinished git operation to the menu unless a job holds its transcript', () => {
		const stopped = (jobRunId: string | null): PullRequestShip =>
			ship({ phase: 'needs-you', needsYou: needsYou('operation-in-progress', { jobRunId }) });
		expect(topBar(stopped(null), null).action?.disabled).toBe(true);
		expect(topBar(stopped('run-2'), null).action?.disabled).toBe(false);
	});

	it('offers Retry, Cancel merge, Abort and Refresh', () => {
		const bar = topBar(
			ship({ phase: 'needs-you', needsYou: needsYou('operation-in-progress') }),
			surface({ operationInProgress: 'cherry-pick' }),
		);
		expect(bar.menu).toEqual([
			{ id: 'retry-merge', label: 'Retry', confirmLabel: null },
			{ id: 'cancel-merge', label: 'Cancel merge', confirmLabel: 'Confirm cancel' },
			{ id: 'abort-operation', label: 'Abort cherry-pick', confirmLabel: 'Confirm abort' },
			{ id: 'refresh', label: 'Refresh', confirmLabel: null },
		]);
	});
});

describe('the top bar setup blockers', () => {
	it('asks to connect GitHub when the repository has no GitHub remote', () => {
		expect(topBar(null, surface(), 'github-unavailable').action).toMatchObject({
			kind: 'unavailable',
			label: 'Connect GitHub',
			disabled: true,
			tone: 'secondary',
		});
	});

	it('asks to enable the Repository extension', () => {
		expect(topBar(ship(), null, 'extension-unavailable').action).toMatchObject({
			kind: 'unavailable',
			label: 'Enable Repository',
			disabled: true,
		});
	});

	it('asks to connect the GitHub account when the pull request cannot be read', () => {
		expect(
			topBar(null, surface({ pullRequest: pullRequest({ state: 'unavailable' }) })).action,
		).toMatchObject({ kind: 'unavailable', label: 'Connect GitHub' });
	});

	it('asks to reconnect GitHub when the stored sign-in stopped working', () => {
		const github = {
			session: 'reconnect-required' as const,
			reference: null,
			refreshing: false,
			title: null,
			branch: null,
			url: null,
			checks: [],
			checksSummary: '',
			review: null,
			todos: null,
			changes: null,
		};
		expect(topBar(ship(), surface({ github })).action).toMatchObject({
			kind: 'reconnect',
			label: 'Reconnect GitHub',
			disabled: false,
		});
	});

	it('lets a draft in flight show over the blockers', () => {
		expect(
			topBar(ship({ step: 'opening-draft', pullRequestNumber: null }), null, 'github-unavailable')
				.action?.kind,
		).toBe('opening-draft');
	});
});

describe('the top bar while a git operation holds the worktree', () => {
	it.each(['rebase', 'cherry-pick', 'revert'] as const)(
		'blocks shipping during a %s and offers to abort it',
		(operation) => {
			const bar = topBar(ship(), surface({ operationInProgress: operation }));
			expect(bar.action).toMatchObject({ kind: 'operation', disabled: true, tone: 'secondary' });
			expect(bar.action?.tooltip).toContain(`A ${operation} stopped part-way`);
			expect(bar.menu).toContainEqual({
				id: 'abort-operation',
				label: `Abort ${operation}`,
				confirmLabel: 'Confirm abort',
			});
		},
	);

	it('blocks shipping while a merge still has conflict markers', () => {
		const action = topBar(
			null,
			surface({ operationInProgress: 'merge', conflictMarkerPaths: ['a.ts', 'b.ts'] }),
		).action;
		expect(action).toMatchObject({ kind: 'operation', label: 'Merge in progress' });
		expect(action?.tooltip).toBe(
			'2 files still have conflict markers. Resolve them, or abort the merge from the pull request menu',
		);
	});

	it('ships a merge whose conflicts are resolved', () => {
		expect(topBar(null, surface({ operationInProgress: 'merge' })).action?.kind).toBe('open-draft');
	});
});

describe('the top bar status details', () => {
	it('reports the worktree or pull request read failure and offers Refresh', () => {
		for (const failure of [
			{ localError: 'git status failed' },
			{ pullRequestError: 'gh could not read the pull request' },
		]) {
			const bar = topBar(null, surface({ changedFiles: 0, ...failure }));
			expect(bar.remoteFailure).toBe(Object.values(failure)[0]);
			expect(menu(bar)).toEqual(['refresh']);
		}
		expect(topBar(null, surface({ pullRequestRefreshStatus: 'error' })).remoteFailure).toBe(
			'Pull request status is unavailable',
		);
	});

	it('takes the pull request number and address from the read, then from the queue', () => {
		expect(
			topBar(null, surface({ pullRequest: pullRequest({ number: 7, url: 'u7' }) })),
		).toMatchObject({ pullRequestNumber: 7, url: 'u7' });
		expect(topBar(ship({ pullRequestNumber: 9, pullRequestUrl: 'u9' }), null)).toMatchObject({
			pullRequestNumber: 9,
			url: 'u9',
		});
		expect(topBar(null, surface())).toMatchObject({ pullRequestNumber: null, url: null });
	});
});
