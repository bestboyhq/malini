import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import type { PullRequestStatusDto } from '$contract/repositories';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import {
	gate,
	interceptCommand,
	type Gate,
} from '$shared/repositories/application/provisioning.testkit';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSnapshotsHook } from '$shared/repositories/application/hooks/workstream-snapshots.hook';
import Router from '$shared/router/Router.svelte';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: () => import('./WorkstreamsLayout.svelte'),
			page: () => import('../pages/RepositoriesPage.svelte'),
		},
		{ segment: 'settings', page: () => import('$shared/router/fixtures/FixturePage.svelte') },
	],
};

const REFRESHED_ON_RETURN: readonly CommandName[] = [
	'repositories.list-clones',
	'repositories.list-workstreams',
	'repositories.list-repositories',
	'repositories.workstream-snapshot',
];

const DRAFT_PULL_REQUEST: PullRequestStatusDto = {
	state: 'open',
	number: 7,
	url: 'https://github.com/rabbits/hutch/pull/7',
	title: 'Signal Arc',
	draft: true,
	headRef: 'malini/ws-signal',
	baseRef: 'main',
	headSha: 'signal-head',
	includesLocalHead: null,
	mergeable: null,
	mergeableState: null,
	behindBase: null,
	checksState: 'none',
	checks: [],
	viewerCanMerge: null,
	allowedMergeMethods: [],
	defaultMergeMethod: null,
	reviewDecision: null,
	unresolvedReviewThreadCount: null,
	updatedAt: null,
};

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;
let platform: FakePlatform;

beforeEach(() => {
	window.history.replaceState(null, '', '#/');
	host = document.createElement('div');
	document.body.append(host);
	platform = createFakePlatform({
		projects: [
			{
				id: 'project-hutch',
				name: 'hutch',
				repoPath: '/tmp/base/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
			},
		],
		workstreams: [
			{
				id: 'ws-signal',
				projectId: 'project-hutch',
				name: 'Signal Arc',
				path: '/tmp/worktrees/ws-signal',
				branch: 'malini/ws-signal',
				baseBranch: 'main',
				status: 'active',
			},
		],
		workstreamChangeTotals: { 'ws-signal': { additions: 2, deletions: 1 } },
	});
	platform.define('pull-requests.status', async () => ({ ...DRAFT_PULL_REQUEST }));
	setPlatformForTest(platform);
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	workstreamChangeTotalsAggregate.reset();
	pullRequestStateAggregate.reset();
	workstreamSnapshotsHook().clear();
	workstreamsAggregate.reset();
	repositoriesAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

async function settle(): Promise<void> {
	for (let attempt = 0; attempt < 50 && router.navigating; attempt += 1) {
		await router.navigating.complete;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
	flushSync();
}

function all(testId: string): HTMLElement[] {
	return [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
}

function holdRefreshes(): Gate<void> {
	const held = gate<void>();
	for (const command of REFRESHED_ON_RETURN)
		interceptCommand(platform, command, () => held.promise);
	return held;
}

type ShellFrame = Readonly<{
	repositoryRows: number;
	listSkeletons: number;
	sidebarSkeletons: number;
	sidebarWorkstreams: number;
	changeTotals: string[];
	pullRequestStates: string[];
}>;

function frame(): ShellFrame {
	return {
		repositoryRows: all('repository-row').length,
		listSkeletons: all('repository-list-skeleton').length,
		sidebarSkeletons: all('repository-sidebar-skeleton').length,
		sidebarWorkstreams: all('sidebar-workstream').length,
		changeTotals: all('sidebar-workstream-change-totals').map(
			(badge) => badge.getAttribute('aria-label') ?? '',
		),
		pullRequestStates: all('sidebar-workstream-status').map(
			(status) => status.dataset.workstreamPullRequestState ?? '',
		),
	};
}

const LOADED: ShellFrame = {
	repositoryRows: 1,
	listSkeletons: 0,
	sidebarSkeletons: 0,
	sidebarWorkstreams: 1,
	changeTotals: ['2 additions, 1 deletions'],
	pullRequestStates: ['draft'],
};

async function openShellAndLoad(): Promise<void> {
	router.start({
		routes,
		notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
	});
	app = mount(Router, { target: host });
	await settle();
	await vi.waitFor(() => {
		flushSync();
		expect(frame()).toEqual(LOADED);
	});
}

describe('coming back to the repositories from a page outside the shell', () => {
	it('shows a skeleton while the first load since boot is pending', async () => {
		const held = holdRefreshes();
		router.start({
			routes,
			notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
		});
		app = mount(Router, { target: host });
		await settle();

		expect(frame()).toMatchObject({ repositoryRows: 0, listSkeletons: 1, sidebarSkeletons: 1 });

		held.resolve();
		await vi.waitFor(() => {
			flushSync();
			expect(frame()).toEqual(LOADED);
		});
	});

	it('renders the cached repositories, workstreams, change totals and pull request states in the first frame while they refresh', async () => {
		await openShellAndLoad();
		await router.goto('/settings');
		await settle();
		expect(frame()).toMatchObject({ repositoryRows: 0, sidebarWorkstreams: 0 });

		const held = holdRefreshes();
		const refreshesBefore = platform.calls.length;
		await router.goto('/');
		await settle();

		expect(frame()).toEqual(LOADED);

		held.resolve();
		await vi.waitFor(() => {
			const refreshed = platform.calls.slice(refreshesBefore).map(({ command }) => command);
			expect(refreshed).toEqual(expect.arrayContaining([...REFRESHED_ON_RETURN]));
		});
		flushSync();
		expect(frame()).toEqual(LOADED);
	});

	it('keeps the empty states, not skeletons, while an empty scope refreshes', async () => {
		platform.seed({ projects: [], workstreams: [] });
		router.start({
			routes,
			notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
		});
		app = mount(Router, { target: host });
		await settle();
		await vi.waitFor(() => {
			flushSync();
			expect(all('repository-sidebar-empty')).toHaveLength(1);
		});
		await router.goto('/settings');
		await settle();

		const held = holdRefreshes();
		await router.goto('/');
		await settle();

		expect(all('repository-sidebar-empty')).toHaveLength(1);
		expect(all('first-run-setup')).toHaveLength(1);
		expect(frame()).toMatchObject({ listSkeletons: 0, sidebarSkeletons: 0 });
		held.resolve();
	});
});
