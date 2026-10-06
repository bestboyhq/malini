import {
	REPOSITORY_STATE_CHANGED_EVENT,
	type RepositorySurfaceState,
} from '@malini-extension/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestStatusDto } from '$contract/repositories';
import { extensionBindings } from '$shared/extensions/bindings';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { ExtensionRepositoryBindingService } from '$shared/repositories/infrastructure/services/extension-repository-binding.service';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';
import { PullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { loadPullRequestStates } from '$lib/pull-requests/infrastructure/services/pull-request-states.service';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { activateExtensionsHook } from '../hooks/activate-extensions.hook';
import { startExtensionRuntimeCommand } from './start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from './stop-extension-runtime.command';

const PROJECT_ID = 'rabbits-hutch';
const NAMES = ['alpha', 'bravo', 'charlie'] as const;
const WORKSTREAMS = NAMES.map((name) => ({
	id: `workstream-${name}`,
	path: `/tmp/malini/worktrees/workstream-${name}`,
	repositoryPath: `/tmp/malini/worktrees/workstream-${name}`,
	branch: `malini/workstream-${name}`,
	baseBranch: 'main',
}));
const [OPENED] = WORKSTREAMS;

let platform: FakePlatform;
let releases: Array<() => void> = [];

beforeEach(async () => {
	platform = createFakePlatform({
		projects: [
			{
				id: PROJECT_ID,
				name: 'hutch',
				repoPath: '/tmp/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
			},
		],
		workstreams: WORKSTREAMS.map(({ id, path, branch, baseBranch }) => ({
			id,
			projectId: PROJECT_ID,
			name: id,
			path,
			branch,
			baseBranch,
			status: 'active',
		})),
	});
	setPlatformForTest(platform);
	await repositoriesAggregate.refresh();
	await workstreamsAggregate.refresh();
	releases = [extensionBindings.bindRepository(new ExtensionRepositoryBindingService())];
	platform.define('pull-requests.status', async (input) =>
		notOpen(input.head, input.base ?? 'main'),
	);
});

afterEach(async () => {
	stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	for (const release of releases.splice(0).reverse()) release();
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	workstreamSnapshotsHook().clear();
	repositoriesAggregate.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('reading pull requests while the app boots', () => {
	it('asks GitHub once per workstream when the sidebar poll starts before the extensions', async () => {
		const answer = holdPullRequestReads();
		const answerOtherTrees = holdOtherWorkstreamTrees();
		const poll = pollPullRequestStates();
		await vi.waitFor(() => expect(pullRequestReads()).toHaveLength(WORKSTREAMS.length));

		const warmed = startExtensions();
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
		answer();
		await poll;
		answerOtherTrees();
		await warmed;

		expect(pullRequestReads().sort()).toEqual(WORKSTREAMS.map(({ branch }) => branch).sort());
	});

	it('asks GitHub once per workstream when the extensions warm up before the sidebar poll', async () => {
		await startExtensions();

		await pollPullRequestStates();

		expect(pullRequestReads().sort()).toEqual(WORKSTREAMS.map(({ branch }) => branch).sort());
	});
});

function startExtensions(): Promise<void> {
	if (!OPENED) throw new Error('the fixture needs a workstream to open');
	startExtensionRuntimeCommand({ knownWorkstreams: () => WORKSTREAMS });
	const warmed = warmedPullRequests();
	activateExtensionsHook()({
		workstream: OPENED,
		currentWorkstreamId: () => OPENED.id,
		creationContext: null,
		onCreationAnnounced: () => undefined,
	});
	return warmed;
}

function pollPullRequestStates(): Promise<void> {
	return new PullRequestStateAggregate(loadPullRequestStates).track(
		WORKSTREAMS.map(({ id, branch, baseBranch }) => ({
			workstreamId: id,
			repoId: `local:${PROJECT_ID}`,
			head: branch,
			base: baseBranch,
		})),
	);
}

async function warmedPullRequests(): Promise<void> {
	const settled = new Set<string>();
	releases.push(
		extensionCommands.onEvent<RepositorySurfaceState>(REPOSITORY_STATE_CHANGED_EVENT, (surface) => {
			if (surface.workstreamId && surface.pullRequestRefreshStatus === 'ready') {
				settled.add(surface.workstreamId);
			}
		}),
	);
	await vi.waitFor(() => expect(WORKSTREAMS.filter(({ id }) => !settled.has(id))).toEqual([]), {
		timeout: 5_000,
	});
}

function holdPullRequestReads(): () => void {
	let answer!: () => void;
	const held = new Promise<void>((resolve) => {
		answer = resolve;
	});
	platform.define('pull-requests.status', async (input) => {
		await held;
		return notOpen(input.head, input.base ?? 'main');
	});
	return answer;
}

function holdOtherWorkstreamTrees(): () => void {
	let answer!: () => void;
	const held = new Promise<void>((resolve) => {
		answer = resolve;
	});
	platform.define('extensions.list-workstream-files', async (input) => {
		if (input.workstreamId !== OPENED?.id) await held;
		return [];
	});
	return answer;
}

function pullRequestReads(): string[] {
	return platform.calls.flatMap(({ command, args }) =>
		command === 'pull-requests.status' &&
		typeof args === 'object' &&
		args !== null &&
		'head' in args &&
		typeof args.head === 'string'
			? [args.head]
			: [],
	);
}

function notOpen(head: string, base: string): PullRequestStatusDto {
	return {
		state: 'not_open',
		number: null,
		url: null,
		title: null,
		draft: null,
		headRef: head,
		baseRef: base,
		headSha: null,
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
