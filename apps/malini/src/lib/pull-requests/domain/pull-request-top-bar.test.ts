import { describe, expect, it } from 'vitest';
import type { ShipNeedsYou, ShipNeedsYouReason } from '$contract/pull-requests';
import type {
	PullRequestAvailability,
	PullRequestMenuItemId,
	PullRequestTopBar,
	WorkstreamStatus,
} from './pull-request-action';
import type { PullRequestShip } from './pull-request-ship';
import { pullRequestTopBar } from './pull-request-top-bar';
import type {
	RepositorySurface,
	SurfacePullRequest,
	SurfacePullRequestCheck,
} from './repository-surface';

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

function status(
	shipState: PullRequestShip | null,
	read: RepositorySurface | null,
	availability: PullRequestAvailability = 'ready',
): WorkstreamStatus | null {
	return topBar(shipState, read, availability).status;
}

type Line = Readonly<{
	tone: WorkstreamStatus['tone'];
	busy: boolean;
	label: string;
	detail: string | null;
	action: string | null;
}>;

function lineOf(shown: WorkstreamStatus | null): Line | null {
	if (!shown) return null;
	const { tone, busy, label, detail, action } = shown;
	return { tone, busy, label, detail, action: action?.label ?? null };
}

function check(overrides: Partial<SurfacePullRequestCheck> = {}): SurfacePullRequestCheck {
	return {
		name: 'test',
		appId: 15_368,
		state: 'completed',
		conclusion: 'success',
		required: null,
		passed: true,
		failed: false,
		notStartedReason: null,
		...overrides,
	};
}

const passed = check();
const running = check({ name: 'e2e', state: 'in_progress', conclusion: null, passed: false });
const failing = check({ name: 'lint', conclusion: 'failure', passed: false, failed: true });

function open(overrides: Partial<SurfacePullRequest> = {}, read: Partial<RepositorySurface> = {}) {
	return surface({ pullRequest: pullRequest(overrides), ...read });
}

const GITHUB_SESSION_EXPIRED = {
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

describe('the workstream status', () => {
	it.each<
		[string, PullRequestShip | null, RepositorySurface | null, PullRequestAvailability, Line | null]
	>([
		['waits silently for the first read', null, null, 'ready', null],
		[
			'invites work on a fresh workstream',
			null,
			surface({ changedFiles: 0 }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Build something great',
				detail: 'Ask the agent for a change',
				action: null,
			},
		],
		[
			'counts local changes and offers Open draft',
			null,
			surface({ changedFiles: 3 }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: '3 files changed',
				detail: 'Not on GitHub yet',
				action: 'Open draft',
			},
		],
		[
			'counts an uncommitted file before it reaches the branch diff',
			null,
			surface({ changedFiles: 0, dirtyPaths: ['src/a.ts'] }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: '1 file changed',
				detail: 'Not on GitHub yet',
				action: 'Open draft',
			},
		],
		[
			'opens a draft busy, with no button',
			ship({ step: 'opening-draft', pullRequestNumber: null, pullRequestUrl: null }),
			null,
			'ready',
			{
				tone: 'idle',
				busy: true,
				label: 'Opening draft',
				detail: 'Committing and pushing',
				action: null,
			},
		],
		[
			'opens the draft once the agent finishes',
			ship({ step: 'waiting-for-agent', pullRequestNumber: null, pullRequestUrl: null }),
			null,
			'ready',
			{
				tone: 'idle',
				busy: true,
				label: 'Opening draft',
				detail: 'After the agent finishes',
				action: null,
			},
		],
		[
			'publishes nowhere without a GitHub remote',
			null,
			surface({ changedFiles: 2 }),
			'github-unavailable',
			{
				tone: 'idle',
				busy: false,
				label: '2 files changed',
				detail: 'No GitHub remote to publish to',
				action: null,
			},
		],
		[
			'points at the inspector when the Repository extension is off',
			ship(),
			null,
			'extension-unavailable',
			{
				tone: 'idle',
				busy: false,
				label: 'Repository extension is off',
				detail: 'Add it back from the inspector',
				action: null,
			},
		],
		[
			'shows an open pull request without checks',
			null,
			open({ checks: 'none' }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Open',
				detail: 'No checks configured',
				action: 'Queue merge',
			},
		],
		[
			'counts running checks',
			null,
			open({ checks: 'pending', checkItems: [passed, running] }),
			'ready',
			{
				tone: 'idle',
				busy: true,
				label: 'Checks running',
				detail: '1 of 2 pending',
				action: 'Queue merge',
			},
		],
		[
			'waits for checks GitHub has not reported yet',
			null,
			open({ checks: 'pending', checkItems: [] }),
			'ready',
			{
				tone: 'idle',
				busy: true,
				label: 'Checks running',
				detail: 'Starting on GitHub',
				action: 'Queue merge',
			},
		],
		[
			'treats a push GitHub has not seen as checks starting',
			null,
			open({ githubLagsPush: true }),
			'ready',
			{
				tone: 'idle',
				busy: true,
				label: 'Checks running',
				detail: 'Starting on GitHub',
				action: 'Queue merge',
			},
		],
		[
			'names the failed checks',
			null,
			open({
				checks: 'failed',
				checkItems: [passed, failing, { ...failing, name: 'e2e' }, { ...failing, name: 'build' }],
			}),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Checks failed',
				detail: 'lint, e2e +1',
				action: 'Queue merge',
			},
		],
		[
			"says GitHub didn't start CI",
			null,
			open({
				checks: 'failed',
				checkItems: [{ ...failing, notStartedReason: 'spending limit reached' }],
			}),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: "CI didn't start",
				detail: 'Spending limit reached',
				action: 'Queue merge',
			},
		],
		[
			'shows conflicts with the base',
			null,
			open({ mergeable: false, mergeableState: 'dirty' }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Merge conflicts',
				detail: 'With main',
				action: 'Queue merge',
			},
		],
		[
			'counts the commits behind the base',
			null,
			open({}, { behind: 3 }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Behind main',
				detail: '3 commits',
				action: 'Queue merge',
			},
		],
		[
			'shows requested changes',
			null,
			open({ reviewDecision: 'changes_requested' }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Changes requested',
				detail: null,
				action: 'Queue merge',
			},
		],
		[
			'counts unresolved threads',
			null,
			open({ unresolvedReviewThreadCount: 2 }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: '2 unresolved threads',
				detail: 'Comments on GitHub',
				action: 'Queue merge',
			},
		],
		[
			'asks for an approval',
			null,
			open({ reviewDecision: 'review_required', checkItems: [passed] }),
			'ready',
			{
				tone: 'idle',
				busy: false,
				label: 'Review required',
				detail: 'Needs an approval',
				action: 'Queue merge',
			},
		],
		[
			'is ready to merge once every check passed',
			null,
			open({ checkItems: [passed, { ...passed, name: 'lint' }] }),
			'ready',
			{
				tone: 'ready',
				busy: false,
				label: 'Ready to merge',
				detail: 'All 2 checks passed',
				action: 'Queue merge',
			},
		],
		[
			'is ready to merge when only an optional check failed',
			null,
			open({ checks: 'failed', checkItems: [passed, { ...failing, required: false }] }),
			'ready',
			{
				tone: 'ready',
				busy: false,
				label: 'Ready to merge',
				detail: '1 optional check failed',
				action: 'Queue merge',
			},
		],
		[
			'folds a draft into the open states',
			null,
			open({ state: 'draft', checkItems: [passed] }),
			'ready',
			{
				tone: 'ready',
				busy: false,
				label: 'Ready to merge',
				detail: 'Checks passed',
				action: 'Queue merge',
			},
		],
		[
			'offers Queue merge from the draft phase before the first read',
			ship(),
			null,
			'ready',
			{ tone: 'idle', busy: false, label: 'Open', detail: null, action: 'Queue merge' },
		],
		[
			'is queued in blue with Cancel',
			ship({ phase: 'queued', step: 'fixing-checks' }),
			surface(),
			'ready',
			{
				tone: 'queued',
				busy: true,
				label: 'Queued for merge',
				detail: 'Fixing checks',
				action: 'Cancel',
			},
		],
		[
			'keeps plumbing steps out of the queued detail',
			ship({ phase: 'queued', step: 'waiting-for-github' }),
			null,
			'ready',
			{ tone: 'queued', busy: true, label: 'Queued for merge', detail: null, action: 'Cancel' },
		],
		[
			'merges without a Cancel',
			ship({ phase: 'queued', step: 'merging' }),
			null,
			'ready',
			{ tone: 'queued', busy: true, label: 'Merging', detail: null, action: null },
		],
		[
			'needs you for a reviewer and opens the pull request',
			ship({ phase: 'needs-you', needsYou: needsYou('reply-to-reviewer') }),
			surface(),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Reviewer needs a reply',
				action: 'Open PR',
			},
		],
		[
			'needs you after a fix gave up and opens its job',
			ship({ phase: 'needs-you', needsYou: needsYou('fix-gave-up', { jobRunId: 'run-1' }) }),
			null,
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Fix gave up',
				action: 'Open job',
			},
		],
		[
			'needs you when GitHub blocks the merge',
			ship({ phase: 'needs-you', needsYou: needsYou('merge-not-permitted') }),
			null,
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'GitHub blocks the merge',
				action: 'Open PR',
			},
		],
		[
			'needs you when the pull request closed under the queue',
			ship({ phase: 'needs-you', needsYou: needsYou('pull-request-closed') }),
			null,
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Pull request was closed',
				action: 'Open PR',
			},
		],
		[
			'needs you when the queue lost the GitHub sign-in',
			ship({ phase: 'needs-you', needsYou: needsYou('github-reconnect') }),
			null,
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'GitHub sign-in expired',
				action: 'Reconnect',
			},
		],
		[
			'needs you to abort a rebase the queue stopped on',
			ship({ phase: 'needs-you', needsYou: needsYou('operation-in-progress') }),
			surface({ operationInProgress: 'rebase' }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Rebase stopped part-way',
				action: 'Abort rebase',
			},
		],
		[
			'needs you for a rebase that stopped outside the queue',
			null,
			surface({ operationInProgress: 'rebase' }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Rebase stopped part-way',
				action: 'Abort rebase',
			},
		],
		[
			'needs you for a merge that still has conflict markers',
			null,
			surface({ operationInProgress: 'merge', conflictMarkerPaths: ['a.ts'] }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Merge has conflicts',
				action: 'Abort merge',
			},
		],
		[
			'needs you when GitHub is unreachable, never green',
			null,
			open({ checkItems: [passed] }, { pullRequestError: 'HTTP 502' }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'GitHub is unreachable',
				action: 'Retry',
			},
		],
		[
			'needs you when the worktree cannot be read',
			null,
			surface({ localError: 'git status failed' }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: "Couldn't read the worktree",
				action: 'Retry',
			},
		],
		[
			'needs you when the GitHub sign-in expired, never green',
			null,
			open({ checkItems: [passed] }, { github: GITHUB_SESSION_EXPIRED }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'GitHub sign-in expired',
				action: 'Reconnect',
			},
		],
		[
			'needs you to connect the repository GitHub account',
			null,
			open({ state: 'unavailable' }),
			'ready',
			{
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'GitHub account not connected',
				action: 'Connect',
			},
		],
		[
			'offers a replacement draft once the pull request closed',
			ship(),
			open({ state: 'closed' }),
			'ready',
			{ tone: 'idle', busy: false, label: 'Closed', detail: 'Not merged', action: 'Open draft' },
		],
		[
			'shows a closed pull request with nothing new as closed only',
			null,
			open({ state: 'closed' }, { changedFiles: 0 }),
			'ready',
			{ tone: 'idle', busy: false, label: 'Closed', detail: 'Not merged', action: null },
		],
		[
			'shows a merge outside the queue in purple',
			null,
			open({ state: 'merged' }),
			'ready',
			{ tone: 'merged', busy: false, label: 'Merged', detail: 'Into main', action: null },
		],
	])('%s', (_, shipState, read, availability, expected) => {
		expect(lineOf(status(shipState, read, availability))).toEqual(expected);
	});

	it('keeps the queue over setup blockers and worktree state', () => {
		const rebasing = surface({ operationInProgress: 'rebase' });
		for (const availability of ['github-unavailable', 'extension-unavailable'] as const) {
			expect(status(ship({ phase: 'queued' }), rebasing, availability)?.tone).toBe('queued');
		}
	});

	it('shows nothing while the first read of the workstream is still pending', () => {
		expect(status(null, surface({ status: 'idle' }))).toBeNull();
		expect(
			status(
				null,
				surface({
					status: 'loading',
					pullRequestRefreshStatus: 'loading',
					pullRequestRefreshedAt: null,
				}),
			),
		).toBeNull();
	});

	it('cannot open a pull request it has no address for', () => {
		const shown = status(
			ship({ phase: 'needs-you', pullRequestUrl: null, needsYou: needsYou('reply-to-reviewer') }),
			null,
		);
		expect(shown?.action).toBeNull();
		expect(shown?.tooltip).toBe('A reviewer requested changes, and only you can answer them.');
	});

	it('explains needs-you in the tooltip with the queue detail', () => {
		expect(
			status(
				ship({
					phase: 'needs-you',
					needsYou: needsYou('reply-to-reviewer', { detail: 'Octo asked for tests' }),
				}),
				null,
			)?.tooltip,
		).toBe('Octo asked for tests.');
	});

	it('confirms Cancel and Abort before they run', () => {
		expect(status(ship({ phase: 'queued' }), null)?.action).toMatchObject({
			kind: 'cancel-merge',
			tone: 'secondary',
			confirmLabel: 'Confirm cancel',
		});
		expect(status(null, surface({ operationInProgress: 'cherry-pick' }))?.action).toMatchObject({
			kind: 'abort-operation',
			label: 'Abort cherry-pick',
			confirmLabel: 'Confirm abort',
		});
	});

	it('names the pull request in the Queue merge label for assistive tech', () => {
		expect(status(null, open())?.action).toMatchObject({
			kind: 'queue-merge',
			ariaLabel: 'Queue merge for pull request #42',
			tone: 'primary',
		});
	});

	it('says why the last attempt failed while malini retries it', () => {
		expect(
			status(
				ship({
					step: 'opening-draft',
					pullRequestNumber: null,
					lastError: "Couldn't reach github.com.",
				}),
				null,
			),
		).toMatchObject({
			detail: 'Retrying after an error',
			tooltip: "Opening the draft failed and malini retries it: Couldn't reach github.com.",
		});
		expect(
			status(ship({ phase: 'queued', step: 'merging', lastError: 'GitHub answered 502' }), null)
				?.tooltip,
		).toBe(
			'Malini is merging the pull request. The last attempt failed and malini retries it: GitHub answered 502',
		);
		expect(
			status(ship({ step: 'pushing', lastError: 'push rejected' }), open())?.action?.tooltip,
		).toBe('Pushing the latest work failed and malini retries it: push rejected');
		expect(
			status(
				ship({ pullRequestNumber: null, pullRequestUrl: null, lastError: 'push rejected' }),
				surface(),
			)?.action?.tooltip,
		).toBe('Opening the draft failed: push rejected. Try again');
	});

	it('keeps the full reason GitHub gave for not starting CI in the tooltip', () => {
		expect(
			status(
				null,
				open({ checks: 'failed', checkItems: [{ ...failing, notStartedReason: 'billing' }] }),
			)?.tooltip,
		).toBe("GitHub didn't start CI: billing");
	});

	it('ships a merge whose conflicts are resolved', () => {
		expect(status(null, surface({ operationInProgress: 'merge' }))?.action?.kind).toBe(
			'open-draft',
		);
	});
});

describe('the pull request detail menu', () => {
	it('keeps Retry and Cancel merge beside a needs-you action', () => {
		const bar = topBar(
			ship({ phase: 'needs-you', needsYou: needsYou('operation-in-progress') }),
			surface({ operationInProgress: 'cherry-pick' }),
		);
		expect(bar.menu).toEqual([
			{ id: 'retry-merge', label: 'Retry', confirmLabel: null },
			{ id: 'cancel-merge', label: 'Cancel merge', confirmLabel: 'Confirm cancel' },
			{ id: 'refresh', label: 'Refresh', confirmLabel: null },
		]);
	});

	it('leaves out what the bar button already does', () => {
		expect(
			menu(topBar(ship({ phase: 'queued' }), surface({ pullRequest: pullRequest() }))),
		).toEqual(['refresh']);
		expect(menu(topBar(null, surface({ pullRequestError: 'HTTP 502' })))).toEqual([]);
	});

	it('offers Refresh once the workstream was read and has a pull request', () => {
		expect(menu(topBar(null, surface({ pullRequest: pullRequest({ state: 'merged' }) })))).toEqual([
			'refresh',
		]);
		expect(menu(topBar(ship({ phase: 'queued', step: 'merging' }), null))).toEqual([
			'cancel-merge',
		]);
		expect(menu(topBar(null, surface({ changedFiles: 0 })))).toEqual([]);
	});

	it('reports the read failure for the detail panel', () => {
		expect(topBar(null, surface({ localError: 'git status failed' })).remoteFailure).toBe(
			'git status failed',
		);
		expect(topBar(null, surface({ pullRequestRefreshStatus: 'error' })).remoteFailure).toBe(
			'Pull request status is unavailable',
		);
	});

	it('takes the pull request number and address from the read, then from the queue', () => {
		expect(
			topBar(null, surface({ pullRequest: pullRequest({ number: 7, url: 'u7' }) })),
		).toMatchObject({
			pullRequestNumber: 7,
			url: 'u7',
		});
		expect(topBar(ship({ pullRequestNumber: 9, pullRequestUrl: 'u9' }), null)).toMatchObject({
			pullRequestNumber: 9,
			url: 'u9',
		});
		expect(topBar(null, surface())).toMatchObject({ pullRequestNumber: null, url: null });
	});
});
