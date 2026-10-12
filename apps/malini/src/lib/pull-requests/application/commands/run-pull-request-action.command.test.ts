import type { ExtensionWorkstream } from '@malini/extension-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import type { ShipStateRecord } from '$contract/pull-requests';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { fakeShips } from '$shared/port/fake/pull-requests.fake';
import { setPlatformForTest } from '$shared/port/platform';
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
const noStaleStatus = (): void => undefined;
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
	it('opens a draft, busy while main takes the intent, then offers Queue merge', async () => {
		readWorkstream();
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Open draft');

		runPullRequestActionCommand(noStaleStatus);
		expect(pullRequestBusyQuery.label).toBe('Opening draft…');
		await settle();

		expect(sent('pull-requests.open-draft')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
		expect(pullRequestBusyQuery.data).toBe(false);
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Queue merge');
	});

	it('queues the merge of an existing pull request', async () => {
		ship({ phase: 'draft', pullRequestNumber: 500 });
		readWorkstream({ dirtyPaths: [], changedFiles: 0 });

		runPullRequestActionCommand(noStaleStatus);
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

		runPullRequestActionCommand(noStaleStatus);
		await settle();

		expect(sent('pull-requests.cancel-merge')).toEqual([{ workstreamId: WORKSTREAM_ID }]);
	});

	it('reads the repository again when GitHub was unreachable', () => {
		trackScope(ACTIVATED);
		readWorkstream({ pullRequestError: 'HTTP 502' });
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Retry');

		runPullRequestActionCommand(noStaleStatus);

		expect(pullRequestBusyQuery.label).toBe('Refreshing…');
	});

	it('aborts the git operation that stopped part-way', () => {
		trackScope(ACTIVATED);
		readWorkstream({ operationInProgress: 'rebase' });
		expect(pullRequestTopBarQuery.data.status?.action?.label).toBe('Abort rebase');

		runPullRequestActionCommand(noStaleStatus);

		expect(pullRequestBusyQuery.label).toBe('Aborting rebase…');
	});

	it('names a refused intent in a toast and frees the button', async () => {
		const error = vi.spyOn(toast, 'error').mockReturnValue(1);
		platform.define('pull-requests.open-draft', async () => {
			throw new Error('GitHub refused the push');
		});
		readWorkstream();

		runPullRequestActionCommand(noStaleStatus);
		await settle();

		expect(error).toHaveBeenCalledWith(
			'Pull request action failed · GitHub refused the push',
			expect.objectContaining({ context: { workstream: WORKSTREAM_ID } }),
		);
		expect(pullRequestBusyQuery.data).toBe(false);
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

		runPullRequestActionCommand(noStaleStatus);
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

		runPullRequestActionCommand(noStaleStatus);
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

		runPullRequestActionCommand(noStaleStatus);
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

		runPullRequestActionCommand(noStaleStatus);
		await settle();

		expect(router.goto).toHaveBeenCalledWith('/');
	});
});
