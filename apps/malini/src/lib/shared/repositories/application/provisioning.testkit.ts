import { flushSync } from 'svelte';
import { vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import type { WorkstreamProvisioningPlan } from '$shared/repositories/domain/provisioning';
import {
	UNOBSERVED_WORKSTREAM_CHECKOUT,
	type Workstream,
} from '$shared/repositories/domain/workstream';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import {
	workstreamDependencyInstall,
	workstreamProvisioning,
} from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { provisioningRetryStore } from '$shared/repositories/infrastructure/stores/provisioning-retry.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';

const fixturePage = () => import('$shared/router/fixtures/FixturePage.svelte');

const routes: RouteNode = {
	segment: '',
	page: fixturePage,
	children: [
		{
			segment: 'workstreams',
			children: [{ segment: ':workstreamId', page: fixturePage }],
		},
	],
};

export type Gate<T> = Readonly<{
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}>;

export function gate<T>(): Gate<T> {
	let resolve: (value: T) => void = () => undefined;
	let reject: (reason: unknown) => void = () => undefined;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

export function provisioningPlan(workstreamId: string): WorkstreamProvisioningPlan {
	return {
		workstreamId,
		projectId: 'local__rabbits__hutch',
		projectRepoPath: '/tmp/base/rabbits__hutch',
		cloneProgressId: 'rabbits__hutch',
		repoUrl: 'https://github.com/rabbits/hutch.git',
		repositoryFullName: 'rabbits/hutch',
		name: 'Signal Arc',
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
	};
}

export function workstream(id: string, overrides: Partial<Workstream> = {}): Workstream {
	return {
		id,
		projectId: 'local__rabbits__hutch',
		name: id,
		path: `/tmp/worktrees/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
		...overrides,
	};
}

export function stageFailedProvisioning(workstreamId: string, failure = 'git clone failed'): void {
	const plan = provisioningPlan(workstreamId);
	workstreamsAggregate.stagePendingWorkstream({
		...workstream(workstreamId),
		path: '',
	});
	workstreamProvisioning.begin(plan);
	workstreamProvisioning.advance(workstreamId, 'worktree');
	workstreamProvisioning.fail(workstreamId, failure);
}

export function installRepositoriesPlatform(): FakePlatform {
	const platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	return platform;
}

export async function openRoute(path: string): Promise<void> {
	window.history.replaceState(null, '', `#${path}`);
	router.start({
		routes,
		notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
	});
	await settleRoute();
}

export async function settleRoute(): Promise<void> {
	for (let attempt = 0; attempt < 50 && router.navigating; attempt += 1) {
		await router.navigating.complete;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
	flushSync();
}

export function currentPath(): string {
	return router.page.url.pathname;
}

export function resetRepositoriesState(): void {
	router.stop();
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	workstreamDependencyInstall.reset();
	provisioningRetryStore.reset();
}

const interceptors = new WeakMap<FakePlatform, Map<string, () => Promise<void> | void>>();

export function interceptCommand(
	platform: FakePlatform,
	command: CommandName,
	before: () => Promise<void> | void,
): void {
	const known = interceptors.get(platform);
	if (known) {
		known.set(command, before);
		return;
	}
	const table = new Map<string, () => Promise<void> | void>([[command, before]]);
	interceptors.set(platform, table);
	const invoke = platform.invoke.bind(platform);
	vi.spyOn(platform, 'invoke').mockImplementation(async (name, args) => {
		await table.get(name)?.();
		return invoke(name, args);
	});
}
