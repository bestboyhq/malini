import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionPullRequestContext, ExtensionWorkstream } from '@malini/extension-api';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { createDesktopExtensionRepository } from './repository.adapter';

const workstream: ExtensionWorkstream = {
	id: 'workstream-1',
	path: '/worktrees/one',
	repositoryPath: '/worktrees/one',
	repositoryFullName: 'rabbits/hutch',
	branch: 'feature/extensions',
	baseBranch: 'main',
};

const patch = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const snapshotPatch = `diff --git a/src/committed.ts b/src/committed.ts
index 1111111..2222222 100644
--- a/src/committed.ts
+++ b/src/committed.ts
@@ -1,2 +1,3 @@
-export const committed = 'old';
+export const committed = 'new';
+export const committedAgain = true;
 export const shared = true;
diff --git a/src/staged.ts b/src/staged.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/staged.ts
@@ -0,0 +1,2 @@
+export const staged = true;
+export const stagedAgain = true;
diff --git a/src/unstaged.ts b/src/unstaged.ts
index 4444444..5555555 100644
--- a/src/unstaged.ts
+++ b/src/unstaged.ts
@@ -1,3 +1,2 @@
-export const unstagedOld = true;
-export const unstagedRemoved = true;
+export const unstagedNew = true;
 export const kept = true;
diff --git a/src/untracked.ts b/src/untracked.ts
new file mode 100644
index 0000000..6666666
--- /dev/null
+++ b/src/untracked.ts
@@ -0,0 +1,3 @@
+export const untracked = true;
+export const untrackedAgain = true;
+export const untrackedThird = true;
`;

afterEach(() => {
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
});

function installFake(): FakePlatform {
	const fake = createFakePlatform();
	setPlatformForTest(fake);
	return fake;
}

function repositoryFor(
	options: Omit<
		Parameters<typeof createDesktopExtensionRepository>[0],
		'workstream' | 'snapshots'
	> = {},
): ReturnType<typeof createDesktopExtensionRepository> {
	return createDesktopExtensionRepository({
		...options,
		workstream: () => workstream,
		snapshots: workstreamSnapshotsHook(),
	});
}

describe('desktop public repository service', () => {
	it('projects native status and parsed diffs through the public API', async () => {
		const platform = installFake();
		platform.define('repositories.workstream-status', async () => ({
			branch: 'feature/extensions',
			dirtyPaths: ['src/a.ts'],
			conflictedPaths: ['src/conflicted.ts'],
			conflictMarkerPaths: ['src/conflicted.ts'],
			ahead: 2,
			behind: 0,
			hasUpstream: false,
			mergeInProgress: true,
			operationInProgress: 'merge',
			headSha: 'head-extensions',
		}));
		const getWorkstreamSnapshot = vi.fn(async () => ({
			patch,
			totals: { additions: 1, deletions: 0, files: 1 },
		}));
		platform.define('repositories.workstream-snapshot', getWorkstreamSnapshot);
		const repository = repositoryFor();

		await expect(repository.status()).resolves.toEqual({
			branch: 'feature/extensions',
			baseBranch: 'main',
			dirtyPaths: ['src/a.ts'],
			conflictedPaths: ['src/conflicted.ts'],
			conflictMarkerPaths: ['src/conflicted.ts'],
			ahead: 2,
			behind: 0,
			hasUpstream: false,
			mergeInProgress: true,
			operationInProgress: 'merge',
			headSha: 'head-extensions',
		});
		await expect(repository.diff('src/a.ts')).resolves.toEqual([
			{
				path: 'src/a.ts',
				patch,
				additions: 1,
				deletions: 0,
			},
		]);
		expect(getWorkstreamSnapshot).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			baseBranch: 'main',
		});
	});

	it('keeps the native snapshot as standard unified diff and matches its authoritative totals', async () => {
		const authoritativeTotal = { additions: 8, deletions: 3, files: 4 };
		const platform = installFake();
		const getWorkstreamSnapshot = vi.fn(async () => ({
			patch: snapshotPatch,
			totals: authoritativeTotal,
		}));
		platform.define('repositories.workstream-snapshot', getWorkstreamSnapshot);
		const repository = repositoryFor();

		const files = await repository.diff();

		expect(files.map((file) => file.path)).toEqual([
			'src/committed.ts',
			'src/staged.ts',
			'src/unstaged.ts',
			'src/untracked.ts',
		]);
		expect(files.every((file) => file.patch.startsWith('diff --git '))).toBe(true);
		expect(
			files.reduce(
				(total, file) => ({
					additions: total.additions + file.additions,
					deletions: total.deletions + file.deletions,
					files: total.files + 1,
				}),
				{ additions: 0, deletions: 0, files: 0 },
			),
		).toEqual(authoritativeTotal);
		expect(getWorkstreamSnapshot).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			baseBranch: 'main',
		});
		expect(getWorkstreamSnapshot).toHaveBeenCalledTimes(1);
	});

	it('filters the full native snapshot to the requested non-first file', async () => {
		const platform = installFake();
		const getWorkstreamSnapshot = vi.fn(async () => ({
			patch: snapshotPatch,
			totals: { additions: 8, deletions: 3, files: 1 },
		}));
		platform.define('repositories.workstream-snapshot', getWorkstreamSnapshot);
		const repository = repositoryFor();

		await expect(repository.diff('./src/unstaged.ts')).resolves.toEqual([
			{
				path: 'src/unstaged.ts',
				patch: expect.stringContaining('diff --git a/src/unstaged.ts b/src/unstaged.ts'),
				additions: 1,
				deletions: 2,
			},
		]);
		expect(getWorkstreamSnapshot).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			baseBranch: 'main',
		});
	});

	it('reads the working tree alone for the uncommitted scope, never the merge-base snapshot', async () => {
		const platform = installFake();
		const getWorkstreamSnapshot = vi.fn(async () => ({
			patch: snapshotPatch,
			totals: { additions: 8, deletions: 3, files: 1 },
		}));
		platform.define('repositories.workstream-snapshot', getWorkstreamSnapshot);
		const loadWorkstreamDiff = vi.fn(async () => patch);
		platform.define('repositories.workstream-diff', loadWorkstreamDiff);
		const repository = repositoryFor();

		await expect(repository.diff(undefined, undefined, 'uncommitted')).resolves.toEqual([
			{ path: 'src/a.ts', patch, additions: 1, deletions: 0 },
		]);
		expect(loadWorkstreamDiff).toHaveBeenCalledWith({ workstreamId: 'workstream-1', path: null });
		expect(getWorkstreamSnapshot).not.toHaveBeenCalled();
	});

	it('narrows the uncommitted scope to one path without a second git read', async () => {
		const platform = installFake();
		const loadWorkstreamDiff = vi.fn(async () => snapshotPatch);
		platform.define('repositories.workstream-diff', loadWorkstreamDiff);
		const repository = repositoryFor();

		await expect(repository.diff('./src/unstaged.ts', undefined, 'uncommitted')).resolves.toEqual([
			{
				path: 'src/unstaged.ts',
				patch: expect.stringContaining('diff --git a/src/unstaged.ts b/src/unstaged.ts'),
				additions: 1,
				deletions: 2,
			},
		]);
		expect(loadWorkstreamDiff).toHaveBeenCalledTimes(1);
	});

	it('defaults to the branch scope so callers written before scopes read what they always read', async () => {
		const platform = installFake();
		const getWorkstreamSnapshot = vi.fn(async () => ({
			patch,
			totals: { additions: 1, deletions: 0, files: 1 },
		}));
		platform.define('repositories.workstream-snapshot', getWorkstreamSnapshot);
		const loadWorkstreamDiff = vi.fn(async () => '');
		platform.define('repositories.workstream-diff', loadWorkstreamDiff);
		const repository = repositoryFor();

		await repository.diff();
		await repository.diff(undefined, undefined, 'branch');

		expect(getWorkstreamSnapshot).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			baseBranch: 'main',
		});
		expect(loadWorkstreamDiff).not.toHaveBeenCalled();
	});

	it('reads a workstream the host knows without making it the one mutations act on', async () => {
		const platform = installFake();
		platform.define('repositories.workstream-status', async () => ({
			branch: 'feature/other',
			dirtyPaths: [],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: 0,
			behind: 0,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
			headSha: null,
		}));
		const other: ExtensionWorkstream = {
			...workstream,
			id: 'workstream-2',
			branch: 'feature/other',
			baseBranch: 'release',
		};
		const pullRequest = vi.fn(
			async (workstreamId: string): Promise<ExtensionPullRequestContext> => ({
				state: 'not_open',
				number: null,
				title: null,
				url: null,
				baseBranch: 'release',
				headBranch: workstreamId,
				checks: 'unknown',
			}),
		);
		const repository = repositoryFor({ knownWorkstreams: () => [other], pullRequest });

		await expect(repository.status(other.id)).resolves.toMatchObject({
			branch: 'feature/other',
			baseBranch: 'release',
		});
		await expect(repository.pullRequest(other.id)).resolves.toMatchObject({ state: 'not_open' });
		expect(pullRequest).toHaveBeenCalledWith(other.id, undefined);
		await expect(repository.commit('Ship it', other.id)).rejects.toThrow(
			'Unknown active extension workstream',
		);
		await expect(repository.status('workstream-unknown')).rejects.toThrow(
			'Unknown extension workstream',
		);
	});

	it('reads the files of the base a workstream starts from in its repository clone', async () => {
		const platform = installFake();
		const baseFiles = vi.fn(async () => ['README.md', 'src/app.ts']);
		platform.define('repositories.base-files', baseFiles);
		const repository = repositoryFor();

		await expect(
			repository.baseFiles?.({ ...workstream, repositoryRootPath: '/repo/clone' }),
		).resolves.toEqual(['README.md', 'src/app.ts']);
		await expect(repository.baseFiles?.(workstream)).resolves.toEqual([]);
		expect(baseFiles).toHaveBeenCalledTimes(1);
		expect(baseFiles).toHaveBeenCalledWith({ repoPath: '/repo/clone', baseBranch: 'main' });
	});

	it('keeps mutations workstream-scoped and rejects empty commits', async () => {
		const platform = installFake();
		const commitWorkstreamCommand = vi.fn(async () => 'abc123');
		platform.define('repositories.commit-workstream', commitWorkstreamCommand);
		const pushWorkstreamCommand = vi.fn(async () => 'feature/extensions');
		platform.define('repositories.push-workstream', pushWorkstreamCommand);
		const pullWorkstreamCommand = vi.fn(async () => 'def456');
		platform.define('repositories.pull-workstream', pullWorkstreamCommand);
		const repository = repositoryFor();

		await expect(repository.commit(' Ship extensions ')).resolves.toBe('abc123');
		expect(commitWorkstreamCommand).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			message: 'Ship extensions',
		});
		const run = { id: 'run-1', messageIfAlreadyCommitted: 'Update workstream' };
		await repository.commit('feat: ship extensions', undefined, run);
		expect(commitWorkstreamCommand).toHaveBeenLastCalledWith({
			workstreamId: 'workstream-1',
			message: 'feat: ship extensions',
			run,
		});
		await repository.push();
		expect(pushWorkstreamCommand).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			expectedRepositoryFullName: 'rabbits/hutch',
		});
		await expect(repository.pullLatest()).resolves.toBe('def456');
		expect(pullWorkstreamCommand).toHaveBeenCalledWith({
			workstreamId: 'workstream-1',
			baseBranch: 'main',
		});
		await expect(repository.commit('  ')).rejects.toThrow('cannot be empty');
	});

	it('returns explicit unavailable pull-request context until the host supplies GitHub data', async () => {
		installFake();
		const repository = repositoryFor();
		await expect(repository.pullRequest()).resolves.toEqual({
			state: 'unavailable',
			number: null,
			title: null,
			url: null,
			baseBranch: 'main',
			headBranch: 'feature/extensions',
			headSha: null,
			mergeable: null,
			mergeableState: null,
			checks: 'unknown',
		});
		expect(repository.markPullRequestReadyForReview).toBeUndefined();
		expect(repository.mergePullRequest).toBeUndefined();
	});

	it('forwards an exact persisted pull-request binding to the host capability', async () => {
		const pullRequest = vi.fn(async () => ({
			state: 'closed' as const,
			number: 12,
			title: 'Closed review',
			url: 'https://example.test/pull/12',
			baseBranch: 'main',
			headBranch: 'feature/extensions',
			headSha: 'head-12',
			mergeable: false,
			mergeableState: 'blocked',
			checks: 'failed' as const,
		}));
		const repository = repositoryFor({
			pullRequest,
		});

		await expect(
			repository.pullRequest(undefined, { pullRequestNumber: 12 }),
		).resolves.toMatchObject({ state: 'closed', number: 12 });
		expect(pullRequest).toHaveBeenCalledWith('workstream-1', { pullRequestNumber: 12 });
	});

	it('delegates pull-request creation only through the host-provided repository capability', async () => {
		const createPullRequest = vi.fn(async (_workstreamId, request) => ({
			state: request.draft ? ('draft' as const) : ('open' as const),
			number: 12,
			title: request.title,
			url: 'https://example.test/pull/12',
			baseBranch: request.baseBranch ?? 'main',
			headBranch: 'feature/extensions',
			checks: 'pending' as const,
		}));
		const repository = repositoryFor({
			createPullRequest,
		});
		await repository.createPullRequest({ title: ' Ship it ', draft: true });
		expect(createPullRequest).toHaveBeenCalledWith('workstream-1', {
			title: 'Ship it',
			draft: true,
		});
	});

	it('exposes host-provided ready-for-review and merge mutations with workstream scoping', async () => {
		const openPullRequest = {
			state: 'open' as const,
			number: 12,
			title: 'Ship it',
			url: 'https://example.test/pull/12',
			baseBranch: 'main',
			headBranch: 'feature/extensions',
			headSha: 'head-12',
			checks: 'success' as const,
		};
		const markPullRequestReadyForReview = vi.fn(async () => openPullRequest);
		const mergePullRequest = vi.fn(async () => ({
			...openPullRequest,
			state: 'merged' as const,
		}));
		const repository = repositoryFor({
			markPullRequestReadyForReview,
			mergePullRequest,
		});

		await repository.markPullRequestReadyForReview?.({ number: 12 });
		await repository.mergePullRequest?.({
			number: 12,
			expectedHeadSha: 'head-12',
			mergeMethod: 'squash',
		});

		expect(markPullRequestReadyForReview).toHaveBeenCalledWith('workstream-1', { number: 12 });
		expect(mergePullRequest).toHaveBeenCalledWith('workstream-1', {
			number: 12,
			expectedHeadSha: 'head-12',
			mergeMethod: 'squash',
		});
	});

	it('exposes exact-head diagnostic reads only when the host provides them', async () => {
		const headSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
		const pullRequestReviewFeedback = vi.fn(async () => ({
			unresolvedThreads: [],
			unresolvedThreadsComplete: true,
			requestedChangeReviews: [],
			requestedChangeReviewsComplete: true,
			truncated: false,
		}));
		const pullRequestCheckDiagnostics = vi.fn(async () => ({
			checkRuns: [],
			checkRunsComplete: true,
			commitStatuses: null,
			commitStatusesComplete: false,
			truncated: false,
		}));
		const repository = repositoryFor({
			pullRequestReviewFeedback,
			pullRequestCheckDiagnostics,
		});

		await expect(
			repository.pullRequestReviewFeedback?.({ number: 12, expectedHeadSha: headSha }),
		).resolves.toMatchObject({ unresolvedThreads: [] });
		await expect(
			repository.pullRequestCheckDiagnostics?.({ number: 12, expectedHeadSha: headSha }),
		).resolves.toMatchObject({ checkRuns: [], commitStatuses: null });
		expect(pullRequestReviewFeedback).toHaveBeenCalledWith('workstream-1', {
			number: 12,
			expectedHeadSha: headSha,
		});
		expect(pullRequestCheckDiagnostics).toHaveBeenCalledWith('workstream-1', {
			number: 12,
			expectedHeadSha: headSha,
		});
		await expect(
			repository.pullRequestCheckDiagnostics?.({ number: 12, expectedHeadSha: 'short' }),
		).rejects.toThrow('full Git object ID');
	});
});
