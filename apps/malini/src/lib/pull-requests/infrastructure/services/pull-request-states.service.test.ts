import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionBindings } from '$shared/extensions/bindings';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { ExtensionRepositoryBindingService } from '$shared/repositories/infrastructure/services/extension-repository-binding.service';
import {
	PULL_REQUEST_STATE_POLL_INTERVAL_MS,
	type PullRequestTarget,
} from '$lib/pull-requests/domain/pull-request-state';
import { loadPullRequestStates } from './pull-request-states.service';

const TARGET: PullRequestTarget = {
	workstreamId: 'ws-signal',
	repoId: 'local:project-hutch',
	head: 'malini/ws-signal',
	base: 'main',
};

let platform: FakePlatform;
let now = 1_000;
let unbind: () => void = () => undefined;

beforeEach(async () => {
	now = 1_000;
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
				id: TARGET.workstreamId,
				projectId: 'project-hutch',
				name: 'Signal Arc',
				path: '/tmp/worktrees/ws-signal',
				branch: TARGET.head,
				baseBranch: TARGET.base,
				status: 'active',
			},
		],
	});
	platform.define('pull-requests.status', async (input) => ({
		state: 'open',
		number: 7,
		url: 'https://github.com/rabbits/hutch/pull/7',
		title: 'Signal Arc',
		draft: true,
		headRef: input.head,
		baseRef: input.base ?? 'main',
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
	}));
	setPlatformForTest(platform);
	await repositoriesAggregate.refresh();
	await workstreamsAggregate.refresh();
	unbind = extensionBindings.bindRepository(new ExtensionRepositoryBindingService(() => now));
});

afterEach(() => {
	unbind();
	repositoriesAggregate.reset();
	workstreamsAggregate.reset();
	setPlatformForTest(null);
});

describe('loading the pull request states the sidebar shows', () => {
	it('reuses a pull request read moments ago, and asks GitHub again on the next poll', async () => {
		const polledAt = now;
		await loadPullRequestStates([TARGET]);
		now = polledAt + 30_000;
		await expect(loadPullRequestStates([TARGET])).resolves.toEqual({
			[TARGET.workstreamId]: 'draft',
		});
		expect(statusReads()).toBe(1);

		now = polledAt + PULL_REQUEST_STATE_POLL_INTERVAL_MS;
		await loadPullRequestStates([TARGET]);

		expect(statusReads()).toBe(2);
	});
});

function statusReads(): number {
	return platform.calls.filter(({ command }) => command === 'pull-requests.status').length;
}
