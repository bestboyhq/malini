import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import type { PullRequestStatusDto } from '$contract/repositories';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { fakeShips } from '$shared/port/fake/pull-requests.fake';
import { setPlatformForTest } from '$shared/port/platform';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSnapshotsHook } from '$shared/repositories/application/hooks/workstream-snapshots.hook';
import Router from '$shared/router/Router.svelte';
import AppShell from './AppShell.svelte';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: () => import('./layouts/WorkstreamsLayout.svelte'),
			page: () => import('./pages/RepositoriesPage.svelte'),
		},
	],
};

const WORKSTREAMS = [
	['ws-signal', 'Signal Arc'],
	['ws-lunar', 'Lunar Relay'],
	['ws-golden', 'Golden Pulse'],
] as const;

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
		workstreams: WORKSTREAMS.map(([id, name]) => ({
			id,
			projectId: 'project-hutch',
			name,
			path: `/tmp/worktrees/${id}`,
			branch: `malini/${id}`,
			baseBranch: 'main',
			status: 'active',
		})),
	});
	platform.define('pull-requests.status', async (input) => pullRequestFor(input.head));
	setPlatformForTest(platform);
	for (const level of ['success', 'warning', 'error', 'info'] as const) {
		vi.spyOn(toast, level).mockReturnValue(1);
	}
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	workstreamChangeTotalsAggregate.reset();
	pullRequestStateAggregate.reset();
	pullRequestShipAggregate.reset();
	workstreamSnapshotsHook().clear();
	workstreamsAggregate.reset();
	repositoriesAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

describe('the sidebar pull request marker', () => {
	it('shows the phase from the merge queue, falling back to the pull request read', async () => {
		await openShell();
		await vi.waitFor(() => {
			flushSync();
			expect(marker('ws-lunar')).toMatchObject({ phase: 'open', label: /Pull request open$/u });
		});
		expect(marker('ws-signal')).toMatchObject({ phase: 'none', label: /No pull request$/u });

		fakeShips(platform).set('ws-lunar', { phase: 'queued', step: 'fixing-checks' });
		fakeShips(platform).set('ws-golden', {
			phase: 'needs-you',
			pullRequestNumber: 9,
			needsYou: { reason: 'reply-to-reviewer', detail: '', jobRunId: null },
		});
		fakeShips(platform).set('ws-signal', { phase: 'draft', pullRequestNumber: 3 });
		flushSync();

		expect(marker('ws-lunar')).toMatchObject({ phase: 'queued', label: /Merge queued$/u });
		expect(marker('ws-golden')).toMatchObject({
			phase: 'needs-you',
			label: /Needs you · Reply to reviewer$/u,
		});
		expect(marker('ws-signal')).toMatchObject({ phase: 'draft', label: /Draft pull request$/u });
	});

	it('tells you when a workstream starts needing you, and when its merge archived it', async () => {
		await openShell();
		fakeShips(platform).set('ws-golden', { phase: 'queued', pullRequestNumber: 9 });
		fakeShips(platform).set('ws-golden', {
			phase: 'needs-you',
			needsYou: { reason: 'merge-not-permitted', detail: '', jobRunId: null },
		});
		fakeShips(platform).merge('ws-golden');

		expect(toast.warning).toHaveBeenCalledWith(
			"Golden Pulse needs you · Can't merge",
			expect.objectContaining({ context: { workstream: 'ws-golden' } }),
		);
		expect(toast.success).toHaveBeenCalledWith(
			'Merged #9 · Golden Pulse archived',
			expect.objectContaining({ context: { workstream: 'ws-golden' } }),
		);
	});
});

async function openShell(): Promise<void> {
	router.start({
		routes,
		notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
	});
	const children = createRawSnippet(() => ({
		render: () => '<div></div>',
		setup: (stage: Element) => {
			const routed = mount(Router, { target: stage });
			return () => void unmount(routed, { outro: false });
		},
	}));
	app = mount(AppShell, { target: host, props: { children } });
	await vi.waitFor(() => {
		flushSync();
		expect(host.querySelectorAll('[data-testid="sidebar-workstream"]')).toHaveLength(3);
	}, 5_000);
}

function marker(workstreamId: string): Readonly<{ phase: string; label: string }> {
	const status = host.querySelector<HTMLElement>(
		`[data-workstream-id="${workstreamId}"] [data-testid="sidebar-workstream-status"]`,
	);
	return {
		phase: status?.dataset.workstreamPullRequestState ?? '',
		label: status?.getAttribute('aria-label') ?? '',
	};
}

function pullRequestFor(head: string): PullRequestStatusDto {
	const open = head === 'malini/ws-lunar';
	return {
		state: open ? 'open' : 'not_open',
		number: open ? 4 : null,
		url: open ? 'https://github.com/rabbits/hutch/pull/4' : null,
		title: open ? 'Lunar Relay' : null,
		draft: false,
		headRef: head,
		baseRef: 'main',
		headSha: open ? 'lunar-head' : null,
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
}
