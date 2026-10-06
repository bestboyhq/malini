import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ExtensionPullRequestContext } from '@malini/extension-api';
import { createTestHost } from '@malini/extension-api/test';
import repositoryExtension, {
	type RepositoryMergeConfirmationRequest,
	type RepositorySurfaceState,
	type RepositoryViewState,
	repositorySurfaceState,
} from '@malini-extension/repository';
import { describe, expect, it } from 'vitest';
import { armedConfirmationSurvives } from '$shared/shell/global-topbar-actions.svelte';
import { liveMergeConfirmation, mergeConfirmationInput } from './merge-confirmation';

const manifest: unknown = JSON.parse(
	readFileSync(
		createRequire(import.meta.url).resolve('@malini-extension/repository/manifest.json'),
		'utf8',
	),
);

const MERGEABLE_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'open',
	number: 42,
	title: 'Reachable merge',
	url: 'https://example.test/pull/42',
	baseBranch: 'main',
	headBranch: 'feature/merge',
	headSha: 'head-42',
	checks: 'success',
	mergeable: true,
	mergeableState: 'clean',
	viewerCanMerge: true,
	allowedMergeMethods: ['squash'],
	defaultMergeMethod: 'squash',
	reviewDecision: 'approved',
	unresolvedReviewThreadCount: 0,
};

async function mergeableHost() {
	return createTestHost({
		manifest,
		fixtureRepository: {
			name: 'merge-reachability',
			branch: 'feature/merge',
			baseBranch: 'main',
			files: { 'README.md': 'merge' },
		},
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: MERGEABLE_PULL_REQUEST,
		},
	});
}

function surfaceWith(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'feature/merge',
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
		pullRequest: { ...MERGEABLE_PULL_REQUEST },
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		...overrides,
	};
}

const CONFIRMATION: RepositoryMergeConfirmationRequest = {
	id: 1,
	pullRequestNumber: 42,
	headSha: 'head-42',
	mergeMethod: 'squash',
};

describe('merge confirmation', () => {
	it('lands a real merge when the route replays the confirmed head revision', async () => {
		const host = await mergeableHost();
		try {
			await host.activate(repositoryExtension);

			const primed = await host.invokeCommand<RepositoryViewState>(
				'malini.repository.request-merge-confirmation',
				mergeConfirmationInput(null),
			);
			expect(primed.mergeConfirmationRequest).toEqual(CONFIRMATION);
			expect(host.recording().some(({ kind }) => kind === 'repository.mergePullRequest')).toBe(
				false,
			);

			const live = liveMergeConfirmation(
				primed.mergeConfirmationRequest,
				repositorySurfaceState(primed).pullRequest,
			);
			const input = mergeConfirmationInput(live);
			expect(input).toEqual({ expectedHeadSha: 'head-42', mergeMethod: 'squash' });

			const merged = await host.invokeCommand<RepositoryViewState>(
				'malini.repository.request-merge-confirmation',
				input,
			);
			const mergeCall = host.recording().find(({ kind }) => kind === 'repository.mergePullRequest');
			expect(mergeCall?.payload).toMatchObject({
				input: { number: 42, expectedHeadSha: 'head-42', mergeMethod: 'squash' },
			});
			expect(merged.context?.pullRequest?.state).toBe('merged');
			expect(merged.mergeConfirmationRequest).toBeNull();
		} finally {
			await host.cleanup();
		}
	});

	it('never merges without a confirmation the human was shown', async () => {
		const host = await mergeableHost();
		try {
			await host.activate(repositoryExtension);
			await host.invokeCommand(
				'malini.repository.request-merge-confirmation',
				mergeConfirmationInput(null),
			);
			expect(host.recording().some(({ kind }) => kind === 'repository.mergePullRequest')).toBe(
				false,
			);
		} finally {
			await host.cleanup();
		}
	});

	it('survives status refreshes that rebuild the surface object without changing it', () => {
		let live = liveMergeConfirmation(CONFIRMATION, surfaceWith().pullRequest);
		expect(live).toBe(CONFIRMATION);
		for (let refresh = 0; refresh < 3; refresh += 1) {
			live = liveMergeConfirmation(
				live,
				surfaceWith({ pullRequestRefreshedAt: refresh }).pullRequest,
			);
		}
		expect(live).toBe(CONFIRMATION);
	});

	it('drops a confirmation once the reviewed head or pull request moves', () => {
		expect(
			liveMergeConfirmation(
				CONFIRMATION,
				surfaceWith({ pullRequest: { ...MERGEABLE_PULL_REQUEST, headSha: 'head-43' } }).pullRequest,
			),
		).toBeNull();
		expect(
			liveMergeConfirmation(
				CONFIRMATION,
				surfaceWith({ pullRequest: { ...MERGEABLE_PULL_REQUEST, number: 43 } }).pullRequest,
			),
		).toBeNull();
		expect(
			liveMergeConfirmation(
				CONFIRMATION,
				surfaceWith({ pullRequest: { ...MERGEABLE_PULL_REQUEST, state: 'merged' } }).pullRequest,
			),
		).toBeNull();
		expect(
			liveMergeConfirmation(CONFIRMATION, surfaceWith({ pullRequest: null }).pullRequest),
		).toBeNull();
		expect(liveMergeConfirmation(CONFIRMATION, null)).toBeNull();
		expect(liveMergeConfirmation(null, surfaceWith().pullRequest)).toBeNull();
	});

	it('sends no input while no confirmation is live, so the command preflights', () => {
		expect(mergeConfirmationInput(null)).toBeUndefined();
	});
});

describe('primed shell confirmation', () => {
	const action = {
		id: 'github-primary',
		label: 'Ready to merge',
		ariaLabel: 'Ready to merge',
		tooltip: '',
		confirmLabel: 'Confirm merge',
		confirmKey: '#42@head-42',
		onInvoke: () => undefined,
	};

	it('survives a status publish that rebuilds the action without changing it', () => {
		expect(armedConfirmationSurvives(action.id, action.confirmKey, [{ ...action }])).toBe(true);
	});

	it('is dropped when the confirmed pull request head moves', () => {
		expect(
			armedConfirmationSurvives(action.id, action.confirmKey, [
				{ ...action, confirmKey: '#42@head-43' },
			]),
		).toBe(false);
	});

	it('is dropped when the action stops offering a confirmation, or disappears', () => {
		expect(
			armedConfirmationSurvives(action.id, action.confirmKey, [
				{ ...action, confirmLabel: null, confirmKey: null },
			]),
		).toBe(false);
		expect(armedConfirmationSurvives(action.id, action.confirmKey, [])).toBe(false);
		expect(armedConfirmationSurvives(null, null, [{ ...action }])).toBe(false);
	});
});
