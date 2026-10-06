import {
	pullRequestCheckFailed,
	pullRequestCheckPassed,
	pullRequestChecksHeadline,
	pullRequestMergeReadiness,
	pullRequestReviewStatusUnavailable,
	repositoryGithubStatus,
	repositorySurfaceState,
	selectPullRequestMergeMethod,
	type RepositorySurfaceState,
	type RepositoryViewState,
} from '@malini-extension/repository';
import type { ExtensionPullRequestCheck, ExtensionPullRequestContext } from '@malini/extension-api';
import type {
	RepositoryCommandOutcome,
	RepositorySurface,
	SurfacePullRequest,
	SurfacePullRequestCheck,
} from '$lib/pull-requests/domain/repository-surface';

type RawRepositorySurface = RepositorySurfaceState;
type RawRepositoryViewState = RepositoryViewState;
type RawPullRequest = ExtensionPullRequestContext;
type RawPullRequestCheck = ExtensionPullRequestCheck;

export class RepositorySurfaceMapper {
	static fromRaw(raw: RawRepositorySurface): RepositorySurface {
		return {
			status: raw.status,
			workstreamId: raw.workstreamId,
			branch: raw.branch,
			baseBranch: raw.baseBranch,
			dirtyPaths: raw.dirtyPaths,
			conflictedPaths: raw.conflictedPaths,
			conflictMarkerPaths: raw.conflictMarkerPaths,
			changedFiles: raw.changedFiles,
			ahead: raw.ahead,
			behind: raw.behind,
			hasUpstream: raw.hasUpstream,
			mergeInProgress: raw.mergeInProgress,
			operationInProgress: raw.operationInProgress,
			pullRequest: raw.pullRequest === null ? null : this.pullRequestFromRaw(raw.pullRequest),
			pullRequestRefreshStatus: raw.pullRequestRefreshStatus,
			pullRequestRefreshedAt: raw.pullRequestRefreshedAt,
			pullRequestSettledAt: raw.pullRequestSettledAt,
			localError: raw.localError,
			pullRequestError: raw.pullRequestError,
			error: raw.error,
			todoStatus: raw.todoStatus,
			todoOpenCount: raw.todoOpenCount,
			todoError: raw.todoError,
			github: repositoryGithubStatus(raw, 'ready'),
		};
	}

	static outcomeFromRaw(raw: RawRepositoryViewState): RepositoryCommandOutcome {
		const request = raw.mergeConfirmationRequest;
		return {
			surface: this.fromRaw(repositorySurfaceState(raw)),
			mergeRequest:
				request === null
					? null
					: {
							pullRequestNumber: request.pullRequestNumber,
							headSha: request.headSha,
							mergeMethod: request.mergeMethod,
						},
		};
	}

	private static pullRequestFromRaw(raw: RawPullRequest): SurfacePullRequest {
		return {
			state: raw.state,
			number: raw.number,
			url: raw.url,
			headSha: raw.headSha ?? null,
			githubLagsPush:
				(raw.state === 'open' || raw.state === 'draft') && raw.includesLocalHead === false,
			mergeable: raw.mergeable ?? null,
			mergeableState: raw.mergeableState ?? null,
			behindBase: raw.behindBase ?? null,
			checks: raw.checks,
			checksHeadline: pullRequestChecksHeadline(raw),
			checkItems: (raw.checkItems ?? []).map((check) => this.checkFromRaw(check)),
			reviewDecision: raw.reviewDecision ?? null,
			unresolvedReviewThreadCount: raw.unresolvedReviewThreadCount ?? null,
			reviewStatusUnavailable: pullRequestReviewStatusUnavailable(raw),
			viewerCanMerge: raw.viewerCanMerge ?? null,
			mergeReadiness: pullRequestMergeReadiness(raw),
			mergeMethod: selectPullRequestMergeMethod(raw),
		};
	}

	private static checkFromRaw(raw: RawPullRequestCheck): SurfacePullRequestCheck {
		return {
			name: raw.name,
			appId: raw.appId,
			state: raw.state,
			conclusion: raw.conclusion,
			required: raw.required,
			passed: pullRequestCheckPassed(raw),
			failed: pullRequestCheckFailed(raw),
			notStartedReason: raw.notStartedReason ?? null,
		};
	}
}
