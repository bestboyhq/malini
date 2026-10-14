import { flushSync, mount, unmount } from 'svelte';
import type { ExtensionPullRequestContext } from '@malini/extension-api';
import {
	REPOSITORY_STATE_CHANGED_EVENT,
	type RepositoryViewState,
} from '@malini-extension/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import type { ShipStateRecord } from '$contract/pull-requests';
import type { WorktreeOperation } from '$contract/repositories';
import TopBar from '$lib/app/presentation/TopBar.svelte';
import { forgetRemovedWorkstreamSurfacesHook } from '$lib/pull-requests/application/hooks/forget-removed-workstream-surfaces.hook';
import { watchShipStatesHook } from '$lib/pull-requests/application/hooks/watch-ship-states.hook';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { fakeShips } from '$shared/port/fake/pull-requests.fake';
import { setPlatformForTest } from '$shared/port/platform';
import { globalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';
import {
	mountWorkstreamTopBarStatus,
	type TopBarStatusHarness,
} from './workstream-top-bar-status.harness.svelte';

const LUNAR = 'ws-lunar';
const GOLDEN = 'ws-golden';

type Read = Readonly<{
	dirtyPaths?: readonly string[];
	pullRequest?: 'none' | 'open' | 'loading';
	operation?: WorktreeOperation;
	conflictMarkerPaths?: readonly string[];
}>;

type Extension = Readonly<{
	calls: readonly string[];
	subscriptions: readonly string[];
	activate(workstreamId: string, read: Read): void;
}>;

let platform: FakePlatform;
let harness: TopBarStatusHarness | null = null;
const releases: (() => void)[] = [];

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
	for (const level of ['success', 'warning', 'error', 'info'] as const) {
		vi.spyOn(toast, level).mockReturnValue(1);
	}
	releases.push(
		watchShipStatesHook(() => 'Lunar'),
		mountTopBar(),
	);
});

afterEach(() => {
	harness?.stop();
	harness = null;
	for (const release of releases.splice(0).reverse()) release();
	repositorySurfaceAggregate.clear();
	pullRequestShipAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

const OPEN_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'open',
	number: 42,
	title: 'Ship it',
	url: 'https://example.test/pull/42',
	baseBranch: 'main',
	headBranch: 'feature',
	headSha: 'head-42',
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

const NO_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'not_open',
	number: null,
	title: null,
	url: null,
	baseBranch: 'main',
	headBranch: 'feature',
	checks: 'none',
};

describe('shipping from the top bar', () => {
	it('opens a draft, then offers to merge it', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);

		expect(headlineText()).toBe('1 file changed');
		expect(secondaryName()).toBe('Open a draft pull request');
		expect(secondary()?.textContent?.trim()).toBe('Draft');
		expect(primaryName()).toBe('Merge');
		secondary()?.click();
		flushSync();
		expect(headlineText()).toBe('Opening draft');
		expect(globalTopBarGithubStatus.current?.action).toBeNull();
		expect(globalTopBarGithubStatus.current?.secondaryAction).toBeNull();

		await vi.waitFor(() => {
			flushSync();
			expect(primaryName()).toBe('Merge pull request #500');
		});
		expect(sent('pull-requests.open-draft')).toEqual([{ workstreamId: LUNAR }]);
		expect(reference()).toBe('#500');
	});

	it('queues the merge of an open pull request', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { pullRequest: 'open' }, 1);

		expect(primaryText()).toBe('Merge');
		primary()?.click();

		await vi.waitFor(() => {
			flushSync();
			expect(headlineText()).toBe('Queued for merge');
		});
		expect(primaryText()).toBe('Cancel');
		expect(sent('pull-requests.queue-merge')).toEqual([{ workstreamId: LUNAR }]);
	});

	it('invites work, with no button, when there is nothing to ship', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, {}, 1);

		expect(headlineText()).toBe('Build something great');
		expect(primary()).toBeNull();
	});
});

describe('a queued merge in the top bar', () => {
	it('names its step beside the button and cancels only on the confirming click', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { pullRequest: 'open' }, 1);
		ship({ phase: 'queued', step: 'fixing-checks', pullRequestNumber: 42 });
		flushSync();

		expect(headlineText()).toBe('Queued for merge · Fixing checks');
		expect(zone()?.dataset['zone']).toBe('queued');
		expect(primaryName()).toBe('Cancel the queued merge');
		expect(primaryText()).toBe('Cancel');

		openDetail();
		expect(detailLabels()).toEqual(['Open on GitHub', 'Refresh']);
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();

		primary()?.click();
		flushSync();
		expect(primaryText()).toBe('Confirm cancel');
		expect(sent('pull-requests.cancel-merge')).toEqual([]);
		primary()?.click();

		await vi.waitFor(() => {
			flushSync();
			expect(primaryText()).toBe('Merge');
		});
		expect(sent('pull-requests.cancel-merge')).toEqual([{ workstreamId: LUNAR }]);
	});

	it('shows before the extension has read the workstream', () => {
		connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		ship({ phase: 'queued', step: 'waiting-for-review', pullRequestNumber: 77 });
		flushSync();

		expect(reference()).toBe('#77');
		expect(headlineText()).toBe('Queued for merge · Waiting for review');
		expect(primaryText()).toBe('Cancel');
	});
});

describe('a merge that needs you in the top bar', () => {
	it('names the reason and opens the pull request for a reviewer to answer', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { pullRequest: 'open' }, 1);
		ship({
			phase: 'needs-you',
			pullRequestNumber: 42,
			pullRequestUrl: 'https://example.test/pull/42',
			needsYou: { reason: 'reply-to-reviewer', detail: 'Octo requested changes', jobRunId: null },
		});
		flushSync();

		expect(headlineText()).toBe('Needs you · Reviewer needs a reply');
		expect(zone()?.dataset['zone']).toBe('needs-you');
		expect(primaryName()).toBe('Open the pull request on GitHub');
		expect(primaryText()).toBe('Open PR');
		primary()?.click();

		await vi.waitFor(() =>
			expect(sent('app.open-external-url')).toEqual([{ url: 'https://example.test/pull/42' }]),
		);
	});

	it('retries from the detail menu', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { pullRequest: 'open' }, 1);
		ship({
			phase: 'needs-you',
			pullRequestNumber: 42,
			needsYou: { reason: 'merge-not-permitted', detail: '', jobRunId: null },
		});
		flushSync();

		openDetail();
		expect(detailLabels()).toEqual(['Open on GitHub', 'Retry', 'Cancel merge', 'Refresh']);
		detail('Retry')?.click();

		await vi.waitFor(() => {
			flushSync();
			expect(headlineText()).toBe('Queued for merge');
		});
		expect(sent('pull-requests.retry-merge')).toEqual([{ workstreamId: LUNAR }]);
	});
});

describe('a git operation that holds the worktree', () => {
	it('needs you during a rebase and offers Abort rebase behind a confirmation', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { pullRequest: 'open', operation: 'rebase' }, 1);

		expect(headlineText()).toBe('Needs you · Rebase stopped part-way');
		expect(primaryText()).toBe('Abort rebase');
		primary()?.click();
		flushSync();
		expect(primaryText()).toBe('Confirm abort');
		primary()?.click();

		await vi.waitFor(() => expect(extension.calls).toContain('malini.repository.abort-operation'));
	});

	it('needs you while a merge still has conflict markers', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(
			extension,
			LUNAR,
			{ dirtyPaths: ['src/index.ts'], operation: 'merge', conflictMarkerPaths: ['src/index.ts'] },
			1,
		);

		expect(headlineText()).toBe('Needs you · Merge has conflicts');
		expect(primaryText()).toBe('Abort merge');
	});
});

describe('the top bar across workstream switches', () => {
	it('shows the last known action of a workstream in the frame the route returns to it', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		expect(primaryText()).toBe('Merge');
		await visit(extension, GOLDEN, {}, 2);
		expect(headlineText()).toBe('Build something great');

		harness.show(route(LUNAR, false, 2));

		expect(primaryText()).toBe('Merge');
	});

	it('keeps the last read action in place while a fresh read is still loading', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		harness.show(route(GOLDEN, false, 2));

		harness.show(route(LUNAR, false, 3));
		extension.activate(LUNAR, { pullRequest: 'loading' });
		harness.show(route(LUNAR, true, 3));
		await vi.waitFor(() =>
			expect(repositorySurfaceAggregate.surfaceFor(LUNAR)?.pullRequestRefreshStatus).toBe(
				'loading',
			),
		);
		flushSync();

		expect(primaryText()).toBe('Merge');
	});

	it('reads the status once per activation, again when the extension reactivates the workstream', async () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		const statusReads = (): number =>
			extension.calls.filter((call) => call === 'malini.repository.status').length;
		expect(statusReads()).toBe(1);

		extension.activate(LUNAR, {});
		harness.show(route(LUNAR, true, 2));

		await vi.waitFor(() => {
			flushSync();
			expect(headlineText()).toBe('Build something great');
		});
		expect(statusReads()).toBe(2);
	});

	it('holds an empty bar while the first read is pending', () => {
		connectExtension();
		harness = mountWorkstreamTopBarStatus(route(GOLDEN, false, 1));

		expect(zone()).not.toBeNull();
		expect(headlineText()).toBeNull();
		expect(primary()).toBeNull();
	});

	it('leaves the repository surface events to the app, which accepts each once', () => {
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(GOLDEN, false, 1));

		expect(
			extension.subscriptions.filter((channel) => channel === REPOSITORY_STATE_CHANGED_EVENT),
		).toEqual([]);
	});

	it('forgets the last status of a workstream once it is removed', async () => {
		releases.push(forgetRemovedWorkstreamSurfacesHook());
		const extension = connectExtension();
		harness = mountWorkstreamTopBarStatus(route(LUNAR, false, 1));
		await visit(extension, LUNAR, { dirtyPaths: ['src/index.ts'] }, 1);
		harness.show(route(GOLDEN, false, 2));

		platform.emit('repositories:workstream-removed', { workstreamId: LUNAR, worktreePath: '/tmp' });
		harness.show(route(LUNAR, false, 2));

		expect(headlineText()).toBeNull();
	});
});

function route(
	workstreamId: string,
	extensionReady: boolean,
	extensionGeneration: number,
): Readonly<{ workstreamId: string; extensionReady: boolean; extensionGeneration: number }> {
	return { workstreamId, extensionReady, extensionGeneration };
}

async function visit(
	extension: Extension,
	workstreamId: string,
	read: Read,
	generation: number,
): Promise<void> {
	harness?.show(route(workstreamId, false, generation));
	extension.activate(workstreamId, read);
	harness?.show(route(workstreamId, true, generation));
	await vi.waitFor(() => expect(repositorySurfaceAggregate.loadFor(workstreamId)).toBe('loaded'));
	flushSync();
}

function ship(patch: Partial<ShipStateRecord>): void {
	fakeShips(platform).set(LUNAR, patch);
}

function sent(command: string): readonly unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

function mountTopBar(): () => void {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(TopBar, { target: host, props: {} });
	flushSync();
	return () => {
		void unmount(app, { outro: false });
		host.remove();
	};
}

function zone(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-testid="global-topbar-github"]');
}

function headlineText(): string | null {
	return (
		document
			.querySelector<HTMLElement>('[data-testid="global-topbar-github-headline"]')
			?.getAttribute('aria-label') ?? null
	);
}

function primary(): HTMLButtonElement | null {
	return document.querySelector<HTMLButtonElement>(
		'[data-testid="global-topbar-github-action"]:not([inert] *)',
	);
}

function primaryName(): string | null {
	return primary()?.getAttribute('aria-label') ?? null;
}

function secondary(): HTMLButtonElement | null {
	return document.querySelector<HTMLButtonElement>(
		'[data-testid="global-topbar-github-secondary-action"]:not([inert] *)',
	);
}

function secondaryName(): string | null {
	return secondary()?.getAttribute('aria-label') ?? null;
}

function primaryText(): string | null {
	return primary()?.textContent?.trim() ?? null;
}

function reference(): string | null {
	return (
		document
			.querySelector<HTMLElement>('[data-testid="global-topbar-github-status"]')
			?.textContent?.trim() ?? null
	);
}

function openDetail(): void {
	document.querySelector<HTMLButtonElement>('[data-testid="global-topbar-github-status"]')?.click();
	flushSync();
}

function detailButtons(): HTMLButtonElement[] {
	return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
}

function detailLabels(): readonly string[] {
	return detailButtons().map((button) => button.textContent?.trim() ?? '');
}

function detail(label: string): HTMLButtonElement | null {
	return detailButtons().find((button) => button.textContent?.trim() === label) ?? null;
}

function connectExtension(): Extension {
	const calls: string[] = [];
	const subscriptions: string[] = [];
	let active: Readonly<{ workstreamId: string; read: Read }> | null = null;
	releases.push(
		extensionCommands.connect({
			workstreamId: () => active?.workstreamId ?? null,
			execute: async (commandId) => {
				calls.push(commandId);
				if (!active) throw new Error('the repository read failed');
				return viewState(active.workstreamId, active.read);
			},
			emit: async () => undefined,
			onEvent: (channel) => {
				subscriptions.push(channel);
				return () => undefined;
			},
		}),
	);
	return {
		calls,
		subscriptions,
		activate(workstreamId: string, read: Read): void {
			active = { workstreamId, read };
		},
	};
}

function viewState(workstreamId: string, read: Read): RepositoryViewState {
	const loading = read.pullRequest === 'loading';
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
			mergeInProgress: read.operation === 'merge',
			operationInProgress: read.operation ?? null,
			dirtyPaths: [...(read.dirtyPaths ?? [])],
			conflictedPaths: [...(read.conflictMarkerPaths ?? [])],
			conflictMarkerPaths: [...(read.conflictMarkerPaths ?? [])],
			pullRequest: loading
				? null
				: read.pullRequest === 'open'
					? { ...OPEN_PULL_REQUEST }
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
		pullRequestRefreshStatus: loading ? 'loading' : 'ready',
		pullRequestRefreshedAt: loading ? null : Date.now() + 1,
		pullRequestSettledAt: loading ? null : Date.now() + 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todos: [],
		todoStatus: 'ready',
		todosObservedAt: 1,
		todoError: null,
	};
}
