import type { ExtensionWorkstream } from '@malini/extension-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import type { ShipStateRecord } from '$contract/pull-requests';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { fakeShips } from '$shared/port/fake/pull-requests.fake';
import { setPlatformForTest } from '$shared/port/platform';
import { refreshWorkstreamsCommand } from '$shared/repositories/repositories.api';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
import { pullRequestTopBarQuery } from '$lib/pull-requests/application/queries/pull-request-top-bar.query.svelte';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { watchShipStatesHook } from '$lib/pull-requests/application/hooks/watch-ship-states.hook';
import { acceptRepositorySurfaceCommand } from './accept-repository-surface.command';
import { releasePullRequestScopeCommand } from './release-pull-request-scope.command';
import { runPullRequestActionCommand } from './run-pull-request-action.command';
import { trackPullRequestScopeCommand } from './track-pull-request-scope.command';

const router = vi.hoisted(() => ({ goto: vi.fn(async (_href: string) => undefined) }));

vi.mock('$shared/router/navigation', () => ({ goto: router.goto }));

const WORKSTREAM_ID = 'ws-signal';
const effects = { onGitStatusStale: (): void => undefined, onArchive: (): void => undefined };
const PULL_REQUEST_URL = 'https://github.com/acme/fake/pull/500';

let platform: FakePlatform;
let stopWatching: (() => void) | null = null;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
	stopWatching = watchShipStatesHook(() => 'Signal Arc');
	trackScope(null);
});

function trackScope(extensionWorkstream: ExtensionWorkstream | null): void {
	trackPullRequestScopeCommand({
		workstreamId: WORKSTREAM_ID,
		agentSessionId: null,
		extensionWorkstream,
		extensionGeneration: 1,
		extensionReady: true,
		repositoryScopeReady: true,
		remotePullRequestsSupported: true,
		repositoryExtensionRegistered: true,
	});
}

const ACTIVATED: ExtensionWorkstream = {
	id: WORKSTREAM_ID,
	path: '/tmp/ws-signal',
	repositoryPath: '/tmp/ws-signal',
	branch: 'malini/ws-signal',
	baseBranch: 'main',
};

afterEach(() => {
	stopWatching?.();
	stopWatching = null;
	releasePullRequestScopeCommand();
	repositorySurfaceAggregate.clear();
	pullRequestShipAggregate.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
	router.goto.mockClear();
	vi.restoreAllMocks();
});

function readWorkstream(overrides: Partial<RepositorySurface> = {}): void {
	acceptRepositorySurfaceCommand(WORKSTREAM_ID, {
		status: 'ready',
		workstreamId: WORKSTREAM_ID,
		branch: 'malini/ws-signal',
		baseBranch: 'main',
		dirtyPaths: ['src/index.ts'],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		changedFiles: 1,
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		pullRequest: null,
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
	});
}

function ship(patch: Partial<ShipStateRecord>): void {
	fakeShips(platform).set(WORKSTREAM_ID, patch);
}

function sent(command: string): readonly unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

async function settle(): Promise<void> {
	for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
}

describe('the top bar primary action', () => {
	it('opens a draft, busy while main takes the intent, then offers Merge', async () => {
		readWorkstream();
		expect(pullRequestTopBarQuery.data.status?.secondaryAction?.label).toBe('Draft');

		runPullRequestActionCommand('open-draft', effects);
		expect(pullRequestBusyQuery.label).toBe('Opening draft');
		await settle();

		expect(sent('pull-requests.open-draft')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
		expect(pullRequestBusyQuery.data).toBe(false);
		expect(pullRequestTopBarQuery.data.status?.action?.ariaLabel).toBe('Merge pull request #500');
	});

	it('runs the button the user clicked only while the bar still offers it', async () => {
		readWorkstream();

		runPullRequestActionCommand('cancel-merge', effects);
		runPullRequestActionCommand('queue-merge', effects);
		await settle();

		expect(sent('pull-requests.cancel-merge')).toEqual([]);
		expect(sent('pull-requests.open-draft')).toEqual([]);
		expect(sent('pull-requests.queue-merge')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
	});

	it('queues the merge of an existing pull request', async () => {
		ship({ phase: 'draft', pullRequestNumber: 500 });
		readWorkstream({ dirtyPaths: [], changedFiles: 0 });

		runPullRequestActionCommand('queue-merge', effects);
		await settle();

		expect(sent('pull-requests.queue-merge')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
		expect(pullRequestTopBarQuery.data.status).toMatchObject({
			tone: 'queued',
			label: 'Queued for merge',
			action: { label: 'Cancel' },
		});
	});

	it('cancels a queued merge', async () => {
		ship({ phase: 'queued', step: 'fixing-checks', pullRequestNumber: 500 });

		runPullRequestActionCommand('cancel-merge', effects);
		await settle();

		expect(sent('pull-requests.cancel-merge')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
	});

	it('reads the repository again when GitHub was unreachable', () => {
		trackScope(ACTIVATED);
		readWorkstream({ pullRequestError: 'HTTP 502' });
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Retry');

		runPullRequestActionCommand('refresh', effects);

		expect(pullRequestBusyQuery.label).toBe('Refreshing…');
	});

	it('aborts the git operation that stopped part-way', () => {
		trackScope(ACTIVATED);
		readWorkstream({ operationInProgress: 'rebase' });
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Abort rebase');

		runPullRequestActionCommand('abort-operation', effects);

		expect(pullRequestBusyQuery.label).toBe('Aborting rebase');
	});

	it('names a refused intent in a toast and frees the button', async () => {
		const error = vi.spyOn(toast, 'error').mockReturnValue(1);
		platform.define('pull-requests.open-draft', async () => {
			throw new Error('GitHub refused the push');
		});
		readWorkstream();

		runPullRequestActionCommand('open-draft', effects);
		await settle();

		expect(error).toHaveBeenCalledWith(
			'Pull request action failed · GitHub refused the push',
			expect.objectContaining({ context: { workstream: WORKSTREAM_ID } }),
		);
		expect(pullRequestBusyQuery.data).toBe(false);
	});
});

describe('a pull request merged on GitHub', () => {
	const MERGED_HEAD = 'a'.repeat(40);

	function readMerged(): void {
		readWorkstream({
			dirtyPaths: [],
			pullRequest: {
				state: 'merged',
				number: 500,
				url: PULL_REQUEST_URL,
				headSha: MERGED_HEAD,
				githubLagsPush: false,
				mergeable: null,
				mergeableState: null,
				behindBase: null,
				checks: 'success',
				checksHeadline: 'Checks passed',
				checkItems: [],
				reviewDecision: null,
				unresolvedReviewThreadCount: 0,
				reviewStatusUnavailable: false,
				viewerCanMerge: null,
				mergeReadiness: 'ready',
				mergeMethod: 'squash',
			},
		});
	}

	it('archives the workstream, or continues it on the latest base', async () => {
		platform.seed({
			projects: [
				{
					id: 'project-signal',
					name: 'signal',
					repoPath: '/tmp/base/signal',
					defaultBranch: 'main',
					remoteUrl: 'https://github.com/acme/signal.git',
				},
			],
			workstreams: [
				{
					id: WORKSTREAM_ID,
					projectId: 'project-signal',
					name: 'Signal Arc',
					path: '/tmp/worktrees/ws-signal',
					branch: 'malini/ws-signal',
					baseBranch: 'main',
					status: 'active',
				},
			],
		});
		refreshWorkstreamsCommand();
		await vi.waitFor(() => expect(workstreamsAggregate.loaded).toBe(true));
		readMerged();
		const onArchive = vi.fn<() => void>();

		runPullRequestActionCommand('archive', { ...effects, onArchive });
		expect(onArchive).toHaveBeenCalledOnce();

		runPullRequestActionCommand('continue', effects);
		expect(pullRequestBusyQuery.label).toBe('Continuing');
		await vi.waitFor(() =>
			expect(sent('repositories.restart-workstream-on-base')).toEqual([
				{
					workstreamId: WORKSTREAM_ID,
					baseBranch: 'main',
					mergedHeadSha: MERGED_HEAD,
					expectedRepositoryFullName: 'acme/signal',
				},
			]),
		);
	});
});

describe('the needs-you action', () => {
	beforeEach(() => {
		vi.spyOn(toast, 'warning').mockReturnValue(1);
	});

	it('opens the pull request on GitHub for a reviewer to answer', async () => {
		ship({
			phase: 'needs-you',
			pullRequestNumber: 500,
			needsYou: { reason: 'reply-to-reviewer', detail: 'Octo asked for tests', jobRunId: null },
		});

		runPullRequestActionCommand('open-pull-request', effects);
		await settle();

		expect(sent('app.open-external-url')).toEqual([{ url: PULL_REQUEST_URL }]);
	});

	it('opens the transcript of the fix job that gave up', async () => {
		platform.define('jobs.list-runs', async () => [
			{
				id: 'run-7',
				definitionId: 'fake-job-fix-checks',
				title: 'Fix checks',
				workstreamId: WORKSTREAM_ID,
				repositoryId: null,
				sessionId: 'session-7',
				agentRunId: null,
				origin: 'merge-queue',
				status: 'needs-you',
				detail: null,
				chatSessionId: null,
				chatAfterRunId: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				startedAt: null,
				finishedAt: null,
			},
		]);
		ship({
			phase: 'needs-you',
			pullRequestNumber: 500,
			needsYou: { reason: 'fix-gave-up', detail: '', jobRunId: 'run-7' },
		});

		runPullRequestActionCommand('open-job', effects);
		await settle();

		expect(router.goto).toHaveBeenCalledWith('/workstreams/ws-signal?agent=session-7');
		expect(sent('app.open-external-url')).toEqual([]);
	});

	it('falls back to the pull request when the job left no transcript', async () => {
		ship({
			phase: 'needs-you',
			pullRequestNumber: 500,
			needsYou: { reason: 'fix-gave-up', detail: '', jobRunId: 'run-gone' },
		});

		runPullRequestActionCommand('open-job', effects);
		await settle();

		expect(router.goto).not.toHaveBeenCalled();
		expect(sent('app.open-external-url')).toEqual([{ url: PULL_REQUEST_URL }]);
	});

	it('sends a lost GitHub sign-in to the repositories page', async () => {
		ship({
			phase: 'needs-you',
			pullRequestNumber: 500,
			needsYou: { reason: 'github-reconnect', detail: '', jobRunId: null },
		});

		runPullRequestActionCommand('reconnect', effects);
		await settle();

		expect(router.goto).toHaveBeenCalledWith('/');
	});
});
