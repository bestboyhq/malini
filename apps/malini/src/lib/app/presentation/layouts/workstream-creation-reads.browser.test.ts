import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import {
	workstreamDependencyInstall,
	workstreamProvisioning,
} from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSnapshotsHook } from '$shared/repositories/application/hooks/workstream-snapshots.hook';
import {
	connectedRepositoriesQuery,
	createWorkstreamForRepositoryCommand,
} from '$shared/repositories/repositories.api';
import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
import Router from '$shared/router/Router.svelte';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';

const fixturePage = () => import('$shared/router/fixtures/FixturePage.svelte');

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: () => import('./WorkstreamsLayout.svelte'),
			page: fixturePage,
			children: [
				{
					segment: 'workstreams',
					children: [{ segment: ':workstreamId', page: fixturePage }],
				},
			],
		},
	],
};

const WORKSTREAM_READS: ReadonlySet<string> = new Set<CommandName>([
	'repositories.workstream-snapshot',
	'repositories.workstream-status',
	'repositories.workstream-diff',
	'repositories.workstream-change-totals',
	'repositories.workstream-files',
	'extensions.list-workstream-files',
]);

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
	});
	setPlatformForTest(platform);
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	workstreamChangeTotalsAggregate.reset();
	pullRequestStateAggregate.reset();
	workstreamSnapshotsHook().clear();
	workstreamProvisioning.reset();
	workstreamDependencyInstall.reset();
	workstreamsAggregate.reset();
	repositoriesAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

describe('creating a workstream', () => {
	it('reads nothing about the new workstream before its checkout exists, and reads it once it does', async () => {
		router.start({
			routes,
			notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
		});
		app = mount(Router, { target: host });
		await settleNavigation();
		await vi.waitFor(() => expect(connectedRepositoriesQuery.data).toHaveLength(1));
		const repository = connectedRepositoriesQuery.data[0];
		if (!repository) throw new Error('the fixture needs a repository');
		const checkout = gate<void>();
		let checkoutRequested = false;
		interceptCommand(platform, 'repositories.create-workstream', () => {
			checkoutRequested = true;
			return checkout.promise;
		});
		let createdAfterCall: number | null = null;
		platform.on('repositories:workstream-created', () => {
			createdAfterCall = platform.calls.length;
		});

		createWorkstreamForRepositoryCommand(repository);
		const created = await openedWorkstreamId();
		await vi.waitFor(() => expect(checkoutRequested).toBe(true));
		await settledPaints();
		const readsWhileSettingUp = readsOf(created);
		checkout.resolve();

		await vi.waitFor(
			() =>
				expect(readsOf(created).map(({ command }) => command)).toEqual(
					expect.arrayContaining([
						'repositories.workstream-snapshot',
						'repositories.workstream-status',
					]),
				),
			{ timeout: 5_000 },
		);
		expect(readsWhileSettingUp).toEqual([]);
		expect(createdAfterCall).not.toBeNull();
		expect(readsOf(created).every(({ index }) => index >= (createdAfterCall ?? Infinity))).toBe(
			true,
		);
	});
});

async function settleNavigation(): Promise<void> {
	for (let attempt = 0; attempt < 50 && router.navigating; attempt += 1) {
		await router.navigating.complete;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	flushSync();
}

async function openedWorkstreamId(): Promise<string> {
	let opened = '';
	await settleNavigation();
	await vi.waitFor(() => {
		flushSync();
		opened = router.page.params.workstreamId ?? '';
		expect(opened).not.toBe('');
		expect(opened).not.toBe('ws-signal');
	});
	return opened;
}

async function settledPaints(): Promise<void> {
	for (let paint = 0; paint < 2; paint += 1) {
		flushSync();
		await new Promise<void>((resolve) => scheduleAfterSettledNavigationPaint(resolve));
	}
	flushSync();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function readsOf(workstreamId: string): { command: string; index: number }[] {
	return platform.calls.flatMap(({ command, args }, index) =>
		WORKSTREAM_READS.has(command) &&
		typeof args === 'object' &&
		args !== null &&
		'workstreamId' in args &&
		args.workstreamId === workstreamId
			? [{ command, index }]
			: [],
	);
}
