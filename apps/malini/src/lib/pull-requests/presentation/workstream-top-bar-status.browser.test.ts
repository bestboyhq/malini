import { flushSync } from 'svelte';
import type { ExtensionPullRequestContext, ExtensionWorkstream } from '@malini/extension-api';
import {
	REPOSITORY_STATE_CHANGED_EVENT,
	type RepositorySurfaceState,
	type RepositoryViewState,
} from '@malini-extension/repository';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startExtensionRuntimeCommand } from '$lib/extensions/application/commands/start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from '$lib/extensions/application/commands/stop-extension-runtime.command';
import { activateExtensionsHook } from '$lib/extensions/application/hooks/activate-extensions.hook';
import { extensionActivationGenerationQuery } from '$lib/extensions/application/queries/extension-activation-generation.query.svelte';
import { extensionRuntimeErrorQuery } from '$lib/extensions/application/queries/extension-runtime-error.query.svelte';
import { extensionRuntimeReadyQuery } from '$lib/extensions/application/queries/extension-runtime-ready.query.svelte';
import { extensionWorkstreamQuery } from '$lib/extensions/application/queries/extension-workstream.query.svelte';
import { acceptRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/accept-repository-surface.command';
import { forgetRemovedWorkstreamSurfacesHook } from '$lib/pull-requests/application/hooks/forget-removed-workstream-surfaces.hook';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { globalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';
import {
	mountWorkstreamTopBarStatus,
	mountWorkstreamTopBarStatusOnTheRuntime,
	type TopBarStatusHarness,
} from './workstream-top-bar-status.harness.svelte';

const LUNAR = 'ws-lunar';
const GOLDEN = 'ws-golden';
const PUBLISH = 'malini.repository.create-or-open-pull-request';

type PullRequestRead = 'fresh' | 'restored' | 'loading' | 'stale-error' | 'fresh-error';

type Read = Readonly<{
	dirtyPaths?: readonly string[];
	conflictedPaths?: readonly string[];
	failingChecks?: boolean;
	pullRequest?: PullRequestRead;
}>;

type Extension = Readonly<{
	calls: readonly string[];
	subscriptions: readonly string[];
	activate(workstreamId: string, read: Read): void;
	failReads(): void;
}>;

let harness: TopBarStatusHarness | null = null;
let disconnect: (() => void) | null = null;
let stopRuntime: (() => Promise<void>) | null = null;

afterEach(async () => {
	harness?.stop();
	harness = null;
	disconnect?.();
	disconnect = null;
	await stopRuntime?.();
	stopRuntime = null;
	repositorySurfaceAggregate.clear();
	setPlatformForTest(null);
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const NO_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'not_open',
	number: null,
	title: null,
	url: null,
	baseBranch: 'main',
	headBranch: 'feature',
	checks: 'none',
};

const FAILING_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'open',
	number: 42,
	title: 'Ship it',
	url: 'https://example.test/pull/42',
	baseBranch: 'main',
	headBranch: 'feature',
	headSha: 'head-42',
	checks: 'failed',
	checkItems: [],
	mergeable: true,
	mergeableState: 'clean',
	viewerCanMerge: true,
	allowedMergeMethods: ['squash'],
	defaultMergeMethod: 'squash',
	reviewDecision: 'approved',
	unresolvedReviewThreadCount: 0,
};

function viewState(workstreamId: string, read: Read): RepositoryViewState {
	const pullRequest = read.pullRequest ?? 'fresh';
	return {
		status: 'ready',
		context: {
			workstreamId,
			repositoryPath: `/tmp/${workstreamId}`,
			branch: `feature/${workstreamId}`,
			baseBranch: 'main',
			ahead: 0,
			behind: 0,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
			dirtyPaths: [...(read.dirtyPaths ?? [])],
			conflictedPaths: [...(read.conflictedPaths ?? [])],
			conflictMarkerPaths: [...(read.conflictedPaths ?? [])],
			pullRequest:
				pullRequest === 'loading'
					? null
					: read.failingChecks
						? { ...FAILING_PULL_REQUEST }
						: { ...NO_PULL_REQUEST },
		},
		files: [],
		selectedPath: null,
		selectedContents: null,
		diff: null,
		diffs: [],
		agentSessionDiff: null,
		changedFiles: read.dirtyPaths?.length ?? 0,
		additions: 0,
		deletions: 0,
		diffScope: 'branch',
		uncommitted: { diffs: [], changedFiles: 0, additions: 0, deletions: 0 },
		refreshedAt: 1,
		pullRequestRefreshStatus:
			pullRequest === 'loading'
				? 'loading'
				: pullRequest === 'stale-error' || pullRequest === 'fresh-error'
					? 'error'
					: 'ready',
		pullRequestRefreshedAt:
			pullRequest === 'fresh' ? Date.now() + 1 : pullRequest === 'loading' ? null : 1,
		pullRequestSettledAt:
			pullRequest === 'fresh' || pullRequest === 'fresh-error'
				? Date.now() + 1
				: pullRequest === 'loading'
					? null
					: 1,
		localError: null,
		pullRequestError:
			pullRequest === 'stale-error' || pullRequest === 'fresh-error'
				? 'gh could not read the pull request'
				: null,
		error: null,
		todos: [],
		todoStatus: 'ready',
		todosObservedAt: 1,
		todoError: null,
	};
}

function connectExtension(): Extension {
	const calls: string[] = [];
	const subscriptions: string[] = [];
	let active: Readonly<{ workstreamId: string; read: Read }> | null = null;
	let failing = false;
	disconnect = extensionCommands.connect({
		workstreamId: () => active?.workstreamId ?? null,
		execute: async (commandId) => {
			calls.push(commandId);
			if (!active || failing) throw new Error('the repository read failed');
			return viewState(active.workstreamId, active.read);
		},
		emit: async () => undefined,
		onEvent: (channel) => {
			subscriptions.push(channel);
			return () => undefined;
		},
	});
	return {
		calls,
		subscriptions,
		activate(workstreamId: string, read: Read): void {
			active = { workstreamId, read };
		},
		failReads(): void {
			failing = true;
		},
	};
}

function publishFreshRead(workstreamId: string, read: Read): void {
	acceptRepositorySurfaceCommand(
		workstreamId,
		RepositorySurfaceMapper.outcomeFromRaw(
			viewState(workstreamId, { ...read, pullRequest: 'fresh' }),
		).surface,
	);
	flushSync();
}

function shownAction(): string | null {
	return globalTopBarGithubStatus.current?.action?.label ?? null;
}

function shownBusy(): boolean {
	return globalTopBarGithubStatus.current?.action?.busy ?? false;
}

function shownPlaceholder(): string | null {
	return globalTopBarGithubStatus.current?.placeholder ?? null;
}

async function visit(
	extension: Extension,
	workstreamId: string,
	read: Read,
	generation: number,
): Promise<void> {
	harness?.show({ workstreamId, extensionReady: false, extensionGeneration: generation });
	extension.activate(workstreamId, read);
	harness?.show({ workstreamId, extensionReady: true, extensionGeneration: generation });
	await vi.waitFor(() => expect(shownAction()).not.toBeNull());
}

async function returnAndClickBeforeTheExtensionIsReady(
	extension: Extension,
	lastRead: Read = { dirtyPaths: ['src/index.ts'] },
): Promise<void> {
	harness = mountWorkstreamTopBarStatus({
		workstreamId: LUNAR,
		extensionReady: false,
		extensionGeneration: 1,
	});
	await visit(extension, LUNAR, lastRead, 1);
	harness.show({ workstreamId: GOLDEN, extensionReady: false, extensionGeneration: 2 });
	harness.show({ workstreamId: LUNAR, extensionReady: false, extensionGeneration: 3 });
	void globalTopBarGithubStatus.current?.action?.onInvoke();
	flushSync();
	expect(shownBusy()).toBe(true);
}

async function settle(): Promise<void> {
	for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
	flushSync();
}

describe('the workstream top bar status across workstream switches', () => {
	it('shows the last known action of a workstream in the frame the route returns to it', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		expect(shownAction()).toBe('Commit and push');
		await visit(extension, GOLDEN, {}, 2);
		expect(shownAction()).toBe('No changes');

		harness.show({ workstreamId: LUNAR, extensionReady: false, extensionGeneration: 2 });

		expect(shownAction()).toBe('Commit and push');
		expect(shownPlaceholder()).toBeNull();
	});

	it('keeps the last read action in place while a fresh read is still loading', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		harness.show({ workstreamId: GOLDEN, extensionReady: false, extensionGeneration: 2 });

		harness.show({ workstreamId: LUNAR, extensionReady: false, extensionGeneration: 3 });
		extension.activate(LUNAR, { dirtyPaths: [], pullRequest: 'loading' });
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() =>
			expect(repositorySurfaceAggregate.surfaceFor(LUNAR)?.pullRequestRefreshStatus).toBe(
				'loading',
			),
		);
		flushSync();

		expect(shownAction()).toBe('Commit and push');
	});

	it('reads the status once per activation, again when the extension reactivates the workstream', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		const statusReads = (): number =>
			extension.calls.filter((call) => call === 'malini.repository.status').length;
		expect(statusReads()).toBe(1);

		extension.activate(LUNAR, { dirtyPaths: [] });
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 2 });

		await vi.waitFor(() => expect(shownAction()).toBe('No changes'));
		expect(statusReads()).toBe(2);
	});

	it('holds a placeholder, never an empty bar, while nothing is known about a workstream', () => {
		connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: GOLDEN,
			extensionReady: false,
			extensionGeneration: 1,
		});

		expect(globalTopBarGithubStatus.current).not.toBeNull();
		expect(shownAction()).toBeNull();
		expect(shownPlaceholder()).toBe('No changes');
	});

	it('stops holding the placeholder once the extension has failed to start', () => {
		connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: GOLDEN,
			extensionReady: false,
			extensionGeneration: 1,
		});

		harness.show({
			workstreamId: GOLDEN,
			extensionReady: false,
			extensionGeneration: 1,
			extensionError: 'Extensions could not start',
		});

		expect(shownPlaceholder()).toBeNull();
	});

	it('stops holding the placeholder once the status read has failed', async () => {
		const extension = connectExtension();
		extension.failReads();
		extension.activate(GOLDEN, {});
		harness = mountWorkstreamTopBarStatus({
			workstreamId: GOLDEN,
			extensionReady: true,
			extensionGeneration: 1,
		});

		await vi.waitFor(() => expect(repositorySurfaceAggregate.loadFor(GOLDEN)).toBe('failed'));
		flushSync();
		expect(shownPlaceholder()).toBeNull();

		harness.show({ workstreamId: GOLDEN, extensionReady: false, extensionGeneration: 2 });

		expect(shownPlaceholder()).toBeNull();
	});

	it('leaves the repository surface events to the app, which accepts each once', () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: GOLDEN,
			extensionReady: false,
			extensionGeneration: 1,
		});

		expect(
			extension.subscriptions.filter((channel) => channel === REPOSITORY_STATE_CHANGED_EVENT),
		).toEqual([]);
	});

	it('forgets the last status of a workstream once it is removed', async () => {
		const platform = createFakePlatform();
		setPlatformForTest(platform);
		const stopForgetting = forgetRemovedWorkstreamSurfacesHook();
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		harness.show({ workstreamId: GOLDEN, extensionReady: false, extensionGeneration: 2 });

		platform.emit('repositories:workstream-removed', { workstreamId: LUNAR, worktreePath: '/tmp' });
		harness.show({ workstreamId: LUNAR, extensionReady: false, extensionGeneration: 2 });

		expect(shownAction()).toBeNull();
		expect(shownPlaceholder()).not.toBeNull();
		stopForgetting();
	});
});

describe('an action clicked before the workstream’s extension is ready', () => {
	it('runs once a pull request read newer than the click confirms the same action', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'] });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });

		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual([
				'malini.repository.status',
				PUBLISH,
			]),
		);
	});

	it('waits past a restored snapshot for a pull request read newer than the click', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'], pullRequest: 'restored' });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']),
		);
		await settle();
		expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']);
		expect(shownBusy()).toBe(true);

		publishFreshRead(LUNAR, { dirtyPaths: ['src/index.ts'] });

		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual([
				'malini.repository.status',
				PUBLISH,
			]),
		);
	});

	it('drops the click when the fresh read names another action', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: [] });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });

		await vi.waitFor(() => expect(shownAction()).toBe('No changes'));
		expect(shownBusy()).toBe(false);
		expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']);
	});

	it('drops the click, and never replays it, when the status read fails', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.failReads();
		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'] });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() => expect(shownBusy()).toBe(false));
		publishFreshRead(LUNAR, { dirtyPaths: ['src/index.ts'] });
		await settle();

		expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']);
	});

	it('drops the click, and never replays it, when the extension fails to start', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		harness?.show({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 3,
			extensionError: 'Extensions could not start',
		});
		expect(shownBusy()).toBe(false);
		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'] });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 4 });
		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']),
		);
		await settle();

		expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']);
	});

	it('drops the click, and never replays it, when the extension activates a second time', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;
		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'], pullRequest: 'loading' });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']),
		);

		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 4 });
		expect(shownBusy()).toBe(false);
		publishFreshRead(LUNAR, { dirtyPaths: ['src/index.ts'] });
		await settle();

		expect(extension.calls).not.toContain(PUBLISH);
	});

	it('drops the click, and never replays it, once it has waited a short while', async () => {
		const extension = connectExtension();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		await returnAndClickBeforeTheExtensionIsReady(extension);

		vi.advanceTimersByTime(8_000);
		flushSync();
		expect(shownBusy()).toBe(false);
		vi.useRealTimers();
		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'] });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() => expect(extension.calls.at(-1)).toBe('malini.repository.status'));
		await settle();

		expect(extension.calls).not.toContain(PUBLISH);
	});

	it('drops the click, and never waits on it again, when its replay cannot claim the extension', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'] });
		harness?.show({
			workstreamId: LUNAR,
			extensionReady: true,
			extensionGeneration: 3,
			extensionWorkstreamId: GOLDEN,
		});
		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']),
		);
		await settle();

		expect(shownBusy()).toBe(false);
		expect(extension.calls).not.toContain(PUBLISH);
	});

	it('drops the click when the fresh read names another fix than the one clicked', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension, { conflictedPaths: ['src/index.ts'] });
		expect(extension.calls).not.toContain('malini.repository.prepare-pull-request-fix');

		extension.activate(LUNAR, { failingChecks: true });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });

		await vi.waitFor(() => expect(shownAction()).toBe('Fix errors'));
		await settle();
		expect(shownBusy()).toBe(false);
		expect(extension.calls).not.toContain('malini.repository.prepare-pull-request-fix');
	});

	it('drops the click at once when a pull request read after the click fails', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'], pullRequest: 'fresh-error' });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });

		await vi.waitFor(() => expect(shownBusy()).toBe(false));
		publishFreshRead(LUNAR, { dirtyPaths: ['src/index.ts'] });
		await settle();
		expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']);
	});

	it('waits past a pull request error settled before the click', async () => {
		const extension = connectExtension();
		await returnAndClickBeforeTheExtensionIsReady(extension);
		const callsBeforeReady = extension.calls.length;

		extension.activate(LUNAR, { dirtyPaths: ['src/index.ts'], pullRequest: 'stale-error' });
		harness?.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 3 });
		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual(['malini.repository.status']),
		);
		await settle();
		expect(shownBusy()).toBe(true);

		publishFreshRead(LUNAR, { dirtyPaths: ['src/index.ts'] });

		await vi.waitFor(() =>
			expect(extension.calls.slice(callsBeforeReady)).toEqual([
				'malini.repository.status',
				PUBLISH,
			]),
		);
	});
});

describe('an action clicked while the extension runtime is still activating the workstream', () => {
	it('runs once the runtime has activated it, read through the queries the page reads', async () => {
		setPlatformForTest(
			createFakePlatform({
				projects: [PROJECT],
				workstreams: [LUNAR, GOLDEN].map((workstreamId) => ({
					id: workstreamId,
					projectId: PROJECT.id,
					name: workstreamId,
					path: runtimeWorkstream(workstreamId).path,
					branch: runtimeWorkstream(workstreamId).branch,
					baseBranch: 'main',
					status: 'active',
				})),
			}),
		);
		startExtensionRuntimeCommand();
		stopRuntime = async () => {
			stopExtensionRuntimeCommand();
			await vi.waitFor(() => expect(extensionRuntimeReadyQuery.data(LUNAR)).toBe(false));
			globalThis.localStorage.clear();
		};
		const extension = connectExtension();
		const onTheRuntime = mountWorkstreamTopBarStatusOnTheRuntime(LUNAR, {
			ready: (workstreamId) => extensionRuntimeReadyQuery.data(workstreamId),
			workstream: () => extensionWorkstreamQuery.data,
			generation: () => extensionActivationGenerationQuery.data,
			error: () => extensionRuntimeErrorQuery.data,
		});
		harness = { show: () => undefined, stop: onTheRuntime.stop };
		const activate = activateExtensionsHook();
		const openOnTheRuntime = (workstreamId: string, read: Read): void => {
			onTheRuntime.goTo(workstreamId);
			extension.activate(workstreamId, read);
			activate({
				workstream: runtimeWorkstream(workstreamId),
				currentWorkstreamId: onTheRuntime.currentWorkstreamId,
				creationContext: null,
				onCreationAnnounced: () => undefined,
			});
			flushSync();
		};

		openOnTheRuntime(LUNAR, { dirtyPaths: ['src/index.ts'] });
		await vi.waitFor(() => expect(extensionRuntimeReadyQuery.data(LUNAR)).toBe(true));
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());
		openOnTheRuntime(GOLDEN, {});
		await vi.waitFor(() => expect(extensionRuntimeReadyQuery.data(GOLDEN)).toBe(true));
		openOnTheRuntime(LUNAR, { dirtyPaths: ['src/index.ts'] });
		expect(extensionRuntimeReadyQuery.data(LUNAR)).toBe(false);
		const callsBeforeClick = extension.calls.length;
		void globalTopBarGithubStatus.current?.action?.onInvoke();
		flushSync();
		expect(shownBusy()).toBe(true);

		await vi.waitFor(() => expect(extension.calls.slice(callsBeforeClick)).toContain(PUBLISH));
		await vi.waitFor(() => expect(shownBusy()).toBe(false));
		expect(extension.calls.filter((call) => call === PUBLISH)).toHaveLength(1);
	});
});

const PULL_LATEST = 'malini.repository.pull-latest';

const READY_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'open',
	number: 55,
	title: 'Ready to merge',
	url: 'https://example.test/pull/55',
	baseBranch: 'main',
	headBranch: 'feature/ready',
	headSha: 'head-55',
	checks: 'success',
	checkItems: [],
	mergeable: true,
	mergeableState: 'clean',
	viewerCanMerge: true,
	allowedMergeMethods: ['squash'],
	defaultMergeMethod: 'squash',
	reviewDecision: 'approved',
	unresolvedReviewThreadCount: 0,
};

function publishReadyPullRequest(
	workstreamId: string,
	behindBase: number | null,
	overrides: Partial<typeof READY_PULL_REQUEST> = {},
	worktree: Partial<RepositorySurfaceState> = {},
): void {
	const surface = RepositorySurfaceMapper.fromRaw({
		status: 'ready',
		workstreamId,
		branch: 'feature/ready',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		changedFiles: 0,
		...worktree,
		pullRequest: { ...READY_PULL_REQUEST, behindBase, ...overrides },
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: Date.now() + 1,
		pullRequestSettledAt: Date.now() + 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
	});
	acceptRepositorySurfaceCommand(workstreamId, surface);
	flushSync();
}

function shownDetailActionLabels(): readonly string[] {
	return (globalTopBarGithubStatus.current?.detailActions ?? []).map((a) => a.label);
}

describe('Update branch detail action when the pull request is behind its base', () => {
	it('shows Update branch in the detail menu and calls pull-latest when the PR has behindBase > 0', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(LUNAR, 2);

		expect(shownAction()).toBe('Merge');
		expect(shownDetailActionLabels()).toContain('Update branch');

		const updateAction = globalTopBarGithubStatus.current?.detailActions?.find(
			(a) => a.label === 'Update branch',
		);
		if (!updateAction) throw new Error('"Update branch" detail action not found');
		void updateAction.onInvoke();
		flushSync();

		await vi.waitFor(() => expect(extension.calls).toContain(PULL_LATEST));
	});

	it('does not show Update branch when behindBase is 0', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(LUNAR, 0);

		expect(shownDetailActionLabels()).not.toContain('Update branch');
	});

	it('does not show Update branch when the pull request conflicts with its base', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(LUNAR, 1, { mergeable: false, mergeableState: 'dirty' });

		expect(shownAction()).toBe('Resolve conflicts');
		expect(shownDetailActionLabels()).not.toContain('Update branch');
	});

	it('offers Abort merge instead of Update branch while the worktree holds a merge', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(
			LUNAR,
			2,
			{ mergeable: false, mergeableState: 'dirty' },
			{
				mergeInProgress: true,
				operationInProgress: 'merge',
				dirtyPaths: ['src/index.ts'],
				conflictedPaths: ['src/index.ts'],
				conflictMarkerPaths: ['src/index.ts'],
			},
		);

		expect(shownAction()).toBe('Resolve conflicts');
		expect(shownDetailActionLabels()).toEqual(['Abort merge', 'Refresh']);

		const abort = globalTopBarGithubStatus.current?.detailActions?.find(
			(action) => action.label === 'Abort merge',
		);
		if (!abort) throw new Error('"Abort merge" detail action not found');
		expect(abort.confirmLabel).toBe('Confirm abort');
		void abort.onInvoke();
		flushSync();

		await vi.waitFor(() => expect(extension.calls).toContain('malini.repository.abort-operation'));
	});

	it('shows a rebase as in progress, never as Commit and push, with Abort rebase behind a confirmation', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(
			LUNAR,
			0,
			{},
			{
				mergeInProgress: true,
				operationInProgress: 'rebase',
				dirtyPaths: ['src/index.ts'],
				conflictedPaths: ['src/index.ts'],
				conflictMarkerPaths: [],
			},
		);

		expect(shownAction()).toBe('Rebase in progress');
		expect(globalTopBarGithubStatus.current?.action?.disabled).toBe(true);
		const abort = globalTopBarGithubStatus.current?.detailActions?.find(
			(action) => action.label === 'Abort rebase',
		);
		expect(abort?.confirmLabel).toBe('Confirm abort');
	});

	it('does not show Update branch when behindBase is null', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus({
			workstreamId: LUNAR,
			extensionReady: false,
			extensionGeneration: 1,
		});
		extension.activate(LUNAR, {});
		harness.show({ workstreamId: LUNAR, extensionReady: true, extensionGeneration: 1 });
		await vi.waitFor(() => expect(shownAction()).not.toBeNull());

		publishReadyPullRequest(LUNAR, null);

		expect(shownDetailActionLabels()).not.toContain('Update branch');
	});
});

const PROJECT = { id: 'p-malini', name: 'malini', repoPath: '/tmp/malini', defaultBranch: 'main' };

function runtimeWorkstream(workstreamId: string): ExtensionWorkstream {
	return {
		id: workstreamId,
		path: `/tmp/malini/worktrees/${workstreamId}`,
		repositoryPath: `/tmp/malini/worktrees/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
	};
}
