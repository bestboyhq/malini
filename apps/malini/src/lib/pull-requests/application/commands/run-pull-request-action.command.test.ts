import type { ExtensionPullRequestContext, ExtensionWorkstream } from '@malini/extension-api';
import type {
	PullRequestActionInput,
	RepositorySurfaceState,
	RepositoryViewState,
} from '@malini-extension/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';
import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
import { acceptRepositorySurfaceCommand } from './accept-repository-surface.command';
import { releasePullRequestScopeCommand } from './release-pull-request-scope.command';
import { runPullRequestActionCommand } from './run-pull-request-action.command';
import { trackPullRequestScopeCommand } from './track-pull-request-scope.command';

const WORKSTREAM_ID = 'workstream-1';

const EXTENSION_WORKSTREAM: ExtensionWorkstream = {
	id: WORKSTREAM_ID,
	path: '/tmp/workstream-1',
	repositoryPath: '/tmp/workstream-1',
	branch: 'feature/ship',
	baseBranch: 'main',
};

const MERGEABLE_PULL_REQUEST: ExtensionPullRequestContext = {
	state: 'open',
	number: 42,
	title: 'Ship it',
	url: 'https://example.test/pull/42',
	baseBranch: 'main',
	headBranch: 'feature/ship',
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

function surface(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: WORKSTREAM_ID,
		branch: 'feature/ship',
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

function viewState(from: RepositorySurfaceState): RepositoryViewState {
	return {
		status: from.status,
		context: {
			workstreamId: from.workstreamId ?? WORKSTREAM_ID,
			repositoryPath: '/tmp/workstream-1',
			branch: from.branch ?? 'feature/ship',
			baseBranch: from.baseBranch ?? 'main',
			ahead: from.ahead,
			behind: from.behind,
			hasUpstream: from.hasUpstream,
			mergeInProgress: from.mergeInProgress,
			operationInProgress: from.operationInProgress,
			dirtyPaths: [...from.dirtyPaths],
			conflictedPaths: [...from.conflictedPaths],
			conflictMarkerPaths: [...from.conflictMarkerPaths],
			pullRequest: from.pullRequest,
		},
		files: [],
		selectedPath: null,
		selectedContents: null,
		diff: null,
		diffs: [],
		agentSessionDiff: null,
		changedFiles: from.changedFiles,
		additions: 0,
		deletions: 0,
		diffScope: 'branch',
		uncommitted: { diffs: [], changedFiles: 0, additions: 0, deletions: 0 },
		refreshedAt: 1,
		pullRequestRefreshStatus: from.pullRequestRefreshStatus,
		pullRequestRefreshedAt: from.pullRequestRefreshedAt,
		pullRequestSettledAt: from.pullRequestSettledAt,
		localError: from.localError,
		pullRequestError: from.pullRequestError,
		error: from.error,
		todos: [],
		todoStatus: from.todoStatus,
		todosObservedAt: 1,
		todoError: from.todoError,
	};
}

function acceptSurface(workstreamId: string, raw: RepositorySurfaceState): void {
	acceptRepositorySurfaceCommand(workstreamId, RepositorySurfaceMapper.fromRaw(raw));
}

type ExtensionCall = Readonly<{ commandId: string; args: readonly unknown[] }>;

type Extension = Readonly<{
	calls: readonly ExtensionCall[];
	release(): void;
}>;

function connectExtension(
	respond: (commandId: string, args: readonly unknown[]) => unknown,
	readWorkstreamId: () => string = () => WORKSTREAM_ID,
): Extension {
	const calls: ExtensionCall[] = [];
	const release = extensionCommands.connect({
		workstreamId: readWorkstreamId,
		execute: async (commandId, ...args) => {
			calls.push({ commandId, args });
			return respond(commandId, args);
		},
		emit: async () => undefined,
		onEvent: () => () => undefined,
	});
	return { calls, release };
}

function seams(
	overrides: Partial<Parameters<typeof runPullRequestActionCommand>[0]> = {},
): Parameters<typeof runPullRequestActionCommand>[0] {
	return {
		submitPrompt: async () => undefined,
		chatEvidence: (): PullRequestActionInput => ({ context: { sessionTitle: 'Ship it' } }),
		onPanelRequested: () => undefined,
		onGitStatusStale: () => undefined,
		...overrides,
	};
}

function focus(overrides: Partial<Parameters<typeof trackPullRequestScopeCommand>[0]> = {}): void {
	trackPullRequestScopeCommand({
		workstreamId: WORKSTREAM_ID,
		agentSessionId: null,
		extensionWorkstream: EXTENSION_WORKSTREAM,
		extensionGeneration: 1,
		extensionReady: true,
		extensionFailed: false,
		repositoryScopeReady: true,
		remotePullRequestsSupported: true,
		repositoryExtensionRegistered: true,
		agentRunning: false,
		...overrides,
	});
}

async function settle(ticks = 12): Promise<void> {
	for (let index = 0; index < ticks; index += 1) await Promise.resolve();
}

let releaseExtension: (() => void) | null = null;

beforeEach(() => {
	releasePullRequestScopeCommand();
});

afterEach(() => {
	releaseExtension?.();
	releaseExtension = null;
	releasePullRequestScopeCommand();
	vi.restoreAllMocks();
});

describe('running the top bar pull request action', () => {
	it('commits and pushes through the named command when the branch already has a pull request', async () => {
		const extension = connectExtension((_, __) => viewState(surface()));
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		runPullRequestActionCommand(seams());
		await settle();

		expect(extension.calls.map(({ commandId }) => commandId)).toEqual([
			'malini.repository.commit-and-push',
		]);
	});

	it('does not commit and push while the workstream agent is still running', async () => {
		const extension = connectExtension(() => viewState(surface()));
		releaseExtension = extension.release;
		focus({ agentRunning: true });
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		runPullRequestActionCommand(seams());
		await settle();

		expect(extension.calls).toEqual([]);
	});

	it('keeps the label of the clicked action while it runs, whatever the status turns into', async () => {
		let finish: (state: RepositoryViewState) => void = () => undefined;
		const extension = connectExtension(
			() => new Promise<RepositoryViewState>((resolve) => (finish = resolve)),
		);
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		runPullRequestActionCommand(seams());
		await settle();
		acceptSurface(
			WORKSTREAM_ID,
			surface({ pullRequest: { ...MERGEABLE_PULL_REQUEST, checks: 'failed' } }),
		);
		expect(pullRequestBusyQuery.label).toBe('Pushing…');

		finish(viewState(surface()));
		await settle();
		expect(pullRequestBusyQuery.data).toBe(false);
		expect(pullRequestBusyQuery.label).toBeNull();
	});

	it('opens the pull request when the branch has none yet', async () => {
		const extension = connectExtension(() => viewState(surface()));
		releaseExtension = extension.release;
		focus();
		acceptSurface(
			WORKSTREAM_ID,
			surface({
				dirtyPaths: ['src/index.ts'],
				pullRequest: { ...MERGEABLE_PULL_REQUEST, state: 'not_open', number: null, url: null },
			}),
		);

		runPullRequestActionCommand(seams());
		await settle();

		expect(extension.calls[0]?.commandId).toBe('malini.repository.create-or-open-pull-request');
	});

	it('hands the chat evidence to the publishing command', async () => {
		const extension = connectExtension(() => viewState(surface()));
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		runPullRequestActionCommand(
			seams({ chatEvidence: () => ({ context: { sessionTitle: 'Ship it' } }) }),
		);
		await settle();

		expect(extension.calls[0]?.args).toEqual([{ context: { sessionTitle: 'Ship it' } }]);
	});

	it('merges on the first click, at the head the top bar shows, without a toast of its own', async () => {
		const extension = connectExtension(() =>
			viewState(surface({ pullRequest: { ...MERGEABLE_PULL_REQUEST, state: 'merged' } })),
		);
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface());
		const info = vi.spyOn(toast, 'info');
		const success = vi.spyOn(toast, 'success');

		runPullRequestActionCommand(seams());
		await settle();

		expect(extension.calls).toEqual([
			{
				commandId: 'malini.repository.merge-pull-request',
				args: [{ expectedHeadSha: 'head-42', mergeMethod: 'squash' }],
			},
		]);
		expect(info).not.toHaveBeenCalled();
		expect(success).not.toHaveBeenCalled();
	});

	it.each([
		{ held: 'replays', headSha: 'head-42', calls: 1 },
		{ held: 'drops', headSha: 'head-43', calls: 0 },
	])(
		'$held a merge clicked before the workstream was ready when the head reads $headSha',
		async ({ headSha, calls }) => {
			const extension = connectExtension(() => viewState(surface()));
			releaseExtension = extension.release;
			focus({ extensionReady: false });
			acceptSurface(WORKSTREAM_ID, surface());

			runPullRequestActionCommand(seams());
			focus();
			acceptSurface(
				WORKSTREAM_ID,
				surface({
					pullRequest: { ...MERGEABLE_PULL_REQUEST, headSha },
					pullRequestRefreshedAt: Date.now() + 1_000,
				}),
			);
			await settle();

			expect(extension.calls).toHaveLength(calls);
		},
	);

	it('falls back to the local status read when the fix context carries no state', async () => {
		const failing = surface({
			pullRequest: { ...MERGEABLE_PULL_REQUEST, checks: 'failed', checkItems: [] },
		});
		const extension = connectExtension((commandId) =>
			commandId === 'malini.repository.prepare-pull-request-fix'
				? {
						pullRequestNumber: 42,
						headSha: 'head-42',
						reviewFeedback: null,
						checkDiagnostics: null,
					}
				: viewState(failing),
		);
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, failing);

		const prompts: string[] = [];
		const panels: string[] = [];
		runPullRequestActionCommand(
			seams({
				submitPrompt: async (prompt) => {
					prompts.push(prompt);
				},
				onPanelRequested: (panelId) => {
					panels.push(panelId);
				},
			}),
		);
		await settle();

		expect(extension.calls.map(({ commandId }) => commandId)).toEqual([
			'malini.repository.prepare-pull-request-fix',
			'malini.repository.status',
		]);
		expect(panels).toEqual(['malini.repository.files-panel']);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain('Fix the current pull request from inside this workstream.');
	});

	it('tells the agent it is resolving conflicts when the worktree holds the conflict', async () => {
		const conflicted = surface({
			mergeInProgress: true,
			operationInProgress: 'merge',
			dirtyPaths: ['src/index.ts'],
			conflictedPaths: ['src/index.ts'],
			conflictMarkerPaths: ['src/index.ts'],
		});
		const extension = connectExtension((commandId) =>
			commandId === 'malini.repository.prepare-pull-request-fix'
				? {
						state: viewState(conflicted),
						pullRequestNumber: 42,
						headSha: 'head-42',
						reviewFeedback: null,
						checkDiagnostics: null,
					}
				: viewState(conflicted),
		);
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, conflicted);

		const prompts: string[] = [];
		runPullRequestActionCommand(
			seams({
				submitPrompt: async (prompt) => {
					prompts.push(prompt);
				},
			}),
		);
		await settle();

		expect(prompts[0]).toContain('Resolve the merge conflicts in this workstream.');
	});

	it('marks the workstream git status stale after a publishing action', async () => {
		const extension = connectExtension(() => viewState(surface()));
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		let stale = 0;
		runPullRequestActionCommand(
			seams({
				onGitStatusStale: () => {
					stale += 1;
				},
			}),
		);
		await settle();

		expect(stale).toBe(1);
	});

	it('reports a failed action against the workstream it ran in', async () => {
		const extension = connectExtension(() => {
			throw new Error('push rejected by the remote');
		});
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));
		const error = vi.spyOn(toast, 'error');

		runPullRequestActionCommand(seams());
		await settle();

		expect(error).toHaveBeenCalledWith('Pull request action failed · push rejected by the remote', {
			context: { workstream: WORKSTREAM_ID },
		});
	});
});

describe('pull request action currency', () => {
	it('drops the result and the fix turn once the route moved to another workstream', async () => {
		const gate: { resolve: ((value: unknown) => void) | null } = { resolve: null };
		const failing = surface({
			pullRequest: { ...MERGEABLE_PULL_REQUEST, checks: 'failed', checkItems: [] },
		});
		const extension = connectExtension(
			() =>
				new Promise((resolve) => {
					gate.resolve = resolve;
				}),
		);
		releaseExtension = extension.release;
		focus();
		acceptSurface(WORKSTREAM_ID, failing);

		const prompts: string[] = [];
		runPullRequestActionCommand(
			seams({
				submitPrompt: async (prompt) => {
					prompts.push(prompt);
				},
			}),
		);
		await settle();

		focus({
			workstreamId: 'workstream-2',
			extensionWorkstream: { ...EXTENSION_WORKSTREAM, id: 'workstream-2' },
		});
		gate.resolve?.({
			pullRequestNumber: 42,
			headSha: 'head-42',
			reviewFeedback: null,
			checkDiagnostics: null,
		});
		await settle();

		expect(prompts).toEqual([]);
		expect(extension.calls.map(({ commandId }) => commandId)).toEqual([
			'malini.repository.prepare-pull-request-fix',
		]);
	});

	it('refuses to act while no extension workstream owns the route', async () => {
		const extension = connectExtension(() => viewState(surface()));
		releaseExtension = extension.release;
		focus({ extensionReady: false });
		acceptSurface(WORKSTREAM_ID, surface({ dirtyPaths: ['src/index.ts'] }));

		runPullRequestActionCommand(seams());
		await settle();

		expect(extension.calls).toEqual([]);
	});
});
