import type {
	ExtensionAPI,
	ExtensionPullRequestContext,
	ExtensionPullRequestCreateInput,
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestDiagnosticsQuery,
	ExtensionPullRequestMergeInput,
	ExtensionPullRequestMetadata,
	ExtensionPullRequestMetadataUpdate,
	ExtensionPullRequestQuery,
	ExtensionPullRequestReadyForReviewInput,
	ExtensionPullRequestReviewFeedback,
	ExtensionRepositoryDiff,
	ExtensionRestartOnBaseInput,
	ExtensionRepositoryDiffScope,
	ExtensionWorkstream,
} from '@malini/extension-api';

import { invoke } from '$shared/port/invoke';
import {
	parseUnifiedDiff,
	type WorkstreamSnapshotReader,
} from '$shared/repositories/repositories.api';

export function createDesktopExtensionRepository(input: {
	workstream: () => ExtensionWorkstream | null;
	knownWorkstreams?: () => readonly ExtensionWorkstream[];
	snapshots: WorkstreamSnapshotReader;
	pullRequest?: (
		workstreamId: string,
		query?: ExtensionPullRequestQuery,
	) => Promise<ExtensionPullRequestContext>;
	createPullRequest?: (
		workstreamId: string,
		request: ExtensionPullRequestCreateInput,
	) => Promise<ExtensionPullRequestContext>;
	markPullRequestReadyForReview?: (
		workstreamId: string,
		request: ExtensionPullRequestReadyForReviewInput,
	) => Promise<ExtensionPullRequestContext>;
	mergePullRequest?: (
		workstreamId: string,
		request: ExtensionPullRequestMergeInput,
	) => Promise<ExtensionPullRequestContext>;
	updatePullRequestMetadata?: (
		workstreamId: string,
		request: ExtensionPullRequestMetadataUpdate,
	) => Promise<ExtensionPullRequestMetadata>;
	pullRequestReviewFeedback?: (
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	) => Promise<ExtensionPullRequestReviewFeedback>;
	pullRequestCheckDiagnostics?: (
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	) => Promise<ExtensionPullRequestCheckDiagnostics>;
	push?: (workstreamId: string) => Promise<string>;
	pull?: (workstreamId: string, baseBranch: string) => Promise<string>;
	restartOnBase?: (workstreamId: string, request: ExtensionRestartOnBaseInput) => Promise<string>;
	refresh?: (workstreamId: string) => Promise<void>;
}): ExtensionAPI['repository'] {
	const workstream = (requested?: string): ExtensionWorkstream => {
		const current = input.workstream();
		if (!current) throw new Error('Extension repository operation requires an active workstream');
		if (requested !== undefined && requested !== current.id) {
			throw new Error(`Unknown active extension workstream: ${requested}`);
		}
		return current;
	};
	const readable = (requested?: string): ExtensionWorkstream => {
		const current = input.workstream();
		if (requested === undefined || requested === current?.id) return workstream(requested);
		const known = input.knownWorkstreams?.().find(({ id }) => id === requested);
		if (!known) throw new Error(`Unknown extension workstream: ${requested}`);
		return known;
	};
	const markPullRequestReadyForReview = input.markPullRequestReadyForReview;
	const mergePullRequest = input.mergePullRequest;
	const updatePullRequestMetadata = input.updatePullRequestMetadata;
	const pullRequestReviewFeedback = input.pullRequestReviewFeedback;
	const pullRequestCheckDiagnostics = input.pullRequestCheckDiagnostics;
	const snapshots = input.snapshots;

	async function diffPatch(
		current: ExtensionWorkstream,
		scope: ExtensionRepositoryDiffScope,
	): Promise<string> {
		if (scope === 'uncommitted') {
			return invoke('repositories.workstream-diff', { workstreamId: current.id, path: null });
		}
		const snapshot = await snapshots.get({
			workstreamId: current.id,
			baseBranch: current.baseBranch,
		});
		return snapshot.patch;
	}

	return {
		baseFiles: async (target) => {
			if (!target.repositoryRootPath) return [];
			return invoke('repositories.base-files', {
				repoPath: target.repositoryRootPath,
				baseBranch: target.baseBranch,
			});
		},
		status: async (workstreamId) => {
			const current = readable(workstreamId);
			const status = await invoke('repositories.workstream-status', { workstreamId: current.id });
			return {
				branch: status.branch,
				baseBranch: current.baseBranch,
				dirtyPaths: [...status.dirtyPaths],
				conflictedPaths: [...status.conflictedPaths],
				conflictMarkerPaths: [...status.conflictMarkerPaths],
				ahead: status.ahead,
				behind: status.behind,
				hasUpstream: status.hasUpstream,
				mergeInProgress: status.mergeInProgress,
				operationInProgress: status.operationInProgress,
				headSha: status.headSha ?? null,
			};
		},
		diff: async (path, workstreamId, scope) => {
			const current = readable(workstreamId);
			const patch = await diffPatch(current, scope ?? 'branch');
			const requestedPath = path === undefined ? null : normalizeDiffPath(path);
			const files = parseUnifiedDiff(patch).filter(
				(file) =>
					requestedPath === null ||
					[file.newPath, file.oldPath].some(
						(candidate) => candidate !== null && normalizeDiffPath(candidate) === requestedPath,
					),
			);
			return files.map((file): ExtensionRepositoryDiff => ({
				path: file.newPath ?? file.oldPath ?? path ?? 'unknown',
				patch: file.rawText,
				additions: file.additions,
				deletions: file.deletions,
			}));
		},
		pullRequest: async (workstreamId, query) => {
			const current = readable(workstreamId);
			if (input.pullRequest) return input.pullRequest(current.id, query);
			return unavailablePullRequest(current);
		},
		createPullRequest: async (request, workstreamId) => {
			const current = workstream(workstreamId);
			if (!request.title.trim()) throw new Error('Pull request title cannot be empty');
			if (!input.createPullRequest) {
				throw new Error('Pull request creation is unavailable for this repository');
			}
			return input.createPullRequest(current.id, {
				...request,
				title: request.title.trim(),
			});
		},
		...(markPullRequestReadyForReview
			? {
					markPullRequestReadyForReview: async (
						request: ExtensionPullRequestReadyForReviewInput,
						workstreamId?: string,
					) => {
						const current = workstream(workstreamId);
						assertPositivePullRequestNumber(request.number);
						return markPullRequestReadyForReview(current.id, request);
					},
				}
			: {}),
		...(mergePullRequest
			? {
					mergePullRequest: async (
						request: ExtensionPullRequestMergeInput,
						workstreamId?: string,
					) => {
						const current = workstream(workstreamId);
						assertPositivePullRequestNumber(request.number);
						return mergePullRequest(current.id, request);
					},
				}
			: {}),
		...(updatePullRequestMetadata
			? {
					updatePullRequestMetadata: async (
						request: ExtensionPullRequestMetadataUpdate,
						workstreamId?: string,
					) => {
						const current = workstream(workstreamId);
						assertPositivePullRequestNumber(request.number);
						return updatePullRequestMetadata(current.id, request);
					},
				}
			: {}),
		...(pullRequestReviewFeedback
			? {
					pullRequestReviewFeedback: async (
						request: ExtensionPullRequestDiagnosticsQuery,
						workstreamId?: string,
					) => {
						const current = workstream(workstreamId);
						assertPositivePullRequestNumber(request.number);
						assertExpectedHeadSha(request.expectedHeadSha);
						return pullRequestReviewFeedback(current.id, request);
					},
				}
			: {}),
		...(pullRequestCheckDiagnostics
			? {
					pullRequestCheckDiagnostics: async (
						request: ExtensionPullRequestDiagnosticsQuery,
						workstreamId?: string,
					) => {
						const current = workstream(workstreamId);
						assertPositivePullRequestNumber(request.number);
						assertExpectedHeadSha(request.expectedHeadSha);
						return pullRequestCheckDiagnostics(current.id, request);
					},
				}
			: {}),
		refresh: async (workstreamId) => {
			const current = workstream(workstreamId);
			snapshots.invalidate({ workstreamId: current.id, baseBranch: current.baseBranch });
			if (input.refresh) await input.refresh(current.id);
			else await invoke('repositories.workstream-status', { workstreamId: current.id });
		},
		commit: async (message, workstreamId, run) => {
			const current = workstream(workstreamId);
			if (!message.trim()) throw new Error('Extension commit message cannot be empty');
			return invoke('repositories.commit-workstream', {
				workstreamId: current.id,
				message: message.trim(),
				...(run ? { run } : {}),
			});
		},
		push: async (workstreamId) => {
			const current = workstream(workstreamId);
			if (input.push) return input.push(current.id);
			const expectedRepositoryFullName = current.repositoryFullName?.trim();
			if (!expectedRepositoryFullName) {
				throw new Error('Repository push requires a resolved GitHub repository identity');
			}
			return invoke('repositories.push-workstream', {
				workstreamId: current.id,
				expectedRepositoryFullName,
			});
		},
		pullLatest: async (baseBranch, workstreamId) => {
			const current = workstream(workstreamId);
			const target = baseBranch?.trim() || current.baseBranch;
			if (input.pull) return input.pull(current.id, target);
			return invoke('repositories.pull-workstream', {
				workstreamId: current.id,
				baseBranch: target,
			});
		},
		restartOnBase: async (request, workstreamId) => {
			const current = workstream(workstreamId);
			const expectedRepositoryFullName = current.repositoryFullName?.trim();
			if (!expectedRepositoryFullName) {
				throw new Error('Continuing after a merge requires a resolved GitHub repository identity');
			}
			assertExpectedHeadSha(request.mergedHeadSha);
			const baseBranch = request.baseBranch.trim() || current.baseBranch;
			if (input.restartOnBase) {
				return input.restartOnBase(current.id, {
					baseBranch,
					mergedHeadSha: request.mergedHeadSha,
				});
			}
			return invoke('repositories.restart-workstream-on-base', {
				workstreamId: current.id,
				baseBranch,
				mergedHeadSha: request.mergedHeadSha,
				expectedRepositoryFullName,
			});
		},
		abortOperation: async (workstreamId) => {
			const current = workstream(workstreamId);
			await invoke('repositories.abort-workstream-operation', { workstreamId: current.id });
		},
	};
}

function assertPositivePullRequestNumber(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error('Pull request number must be a positive integer');
	}
}

function assertExpectedHeadSha(value: string): void {
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value)) {
		throw new Error('Expected pull request head must be a full Git object ID');
	}
}

function normalizeDiffPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function unavailablePullRequest(workstream: ExtensionWorkstream): ExtensionPullRequestContext {
	return {
		state: 'unavailable',
		number: null,
		title: null,
		url: null,
		baseBranch: workstream.baseBranch,
		headBranch: workstream.branch,
		headSha: null,
		mergeable: null,
		mergeableState: null,
		checks: 'unknown',
	};
}
