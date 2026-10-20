import type {
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestCheckRunDiagnostic,
	ExtensionPullRequestContext,
	ExtensionPullRequestMergeMethod,
	ExtensionPullRequestReviewFeedback,
} from '@malini/extension-api';
import type {
	CheckDiagnosticsDto,
	CheckRunDiagnosticDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
} from '$contract/repositories';
import type { Workstream } from '$shared/repositories/domain/workstream';

type RawPullRequestStatus = PullRequestStatusDto;

type RawCheckRunStatus = ExtensionPullRequestCheckRunDiagnostic['status'];

type RawCheckRunConclusion = NonNullable<ExtensionPullRequestCheckRunDiagnostic['conclusion']>;

const MERGE_METHODS: readonly ExtensionPullRequestMergeMethod[] = ['merge', 'squash', 'rebase'];

const CHECK_RUN_STATUSES: readonly RawCheckRunStatus[] = [
	'queued',
	'in_progress',
	'completed',
	'waiting',
	'pending',
	'requested',
];

const CHECK_RUN_CONCLUSIONS: readonly RawCheckRunConclusion[] = [
	'action_required',
	'cancelled',
	'failure',
	'neutral',
	'success',
	'skipped',
	'stale',
	'timed_out',
	'startup_failure',
];

export class ExtensionPullRequestMapper {
	static fromRaw(raw: RawPullRequestStatus): ExtensionPullRequestContext {
		const draft = typeof raw.draft === 'boolean' ? raw.draft : null;
		const unresolvedReviewThreadCount =
			typeof raw.unresolvedReviewThreadCount === 'number' ? raw.unresolvedReviewThreadCount : null;
		return {
			state: raw.state === 'open' && draft ? 'draft' : raw.state,
			number: typeof raw.number === 'number' ? raw.number : null,
			title: typeof raw.title === 'string' ? raw.title : null,
			url: typeof raw.url === 'string' ? raw.url : null,
			baseBranch: raw.baseRef,
			headBranch: raw.headRef,
			headSha: typeof raw.headSha === 'string' ? raw.headSha : null,
			includesLocalHead: typeof raw.includesLocalHead === 'boolean' ? raw.includesLocalHead : null,
			mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
			mergeableState: typeof raw.mergeableState === 'string' ? raw.mergeableState : null,
			behindBase: typeof raw.behindBase === 'number' ? raw.behindBase : null,
			checks: raw.checksState,
			checkItems: (raw.checks ?? []).map((check) => ({
				name: check.name,
				appId: typeof check.appId === 'number' ? check.appId : null,
				state: check.state,
				conclusion: typeof check.conclusion === 'string' ? check.conclusion : null,
				required: typeof check.required === 'boolean' ? check.required : null,
				url: typeof check.url === 'string' ? check.url : null,
				startedAt: typeof check.startedAt === 'string' ? check.startedAt : null,
				completedAt: typeof check.completedAt === 'string' ? check.completedAt : null,
				notStartedReason:
					typeof check.notStartedReason === 'string' ? check.notStartedReason : null,
			})),
			viewerCanMerge: typeof raw.viewerCanMerge === 'boolean' ? raw.viewerCanMerge : null,
			allowedMergeMethods: (raw.allowedMergeMethods ?? []).flatMap((method) => {
				const known = mergeMethod(method);
				return known ? [known] : [];
			}),
			defaultMergeMethod: mergeMethod(raw.defaultMergeMethod),
			reviewDecision: raw.reviewDecision ?? null,
			unresolvedReviewThreadCount,
		};
	}

	static unavailable(workstream: Workstream): ExtensionPullRequestContext {
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

	static reviewFeedbackFromRaw(raw: ReviewFeedbackDto): ExtensionPullRequestReviewFeedback {
		return {
			unresolvedThreads:
				raw.unresolvedThreads === null
					? null
					: raw.unresolvedThreads.map((thread) => ({
							...thread,
							comments: thread.comments.map((comment) => ({ ...comment })),
						})),
			requestedChangeReviews:
				raw.requestedChangeReviews === null
					? null
					: raw.requestedChangeReviews.map((review) => ({ ...review })),
			unresolvedThreadsComplete: raw.unresolvedThreadsComplete,
			requestedChangeReviewsComplete: raw.requestedChangeReviewsComplete,
			truncated: raw.truncated,
		};
	}

	static checkDiagnosticsFromRaw(raw: CheckDiagnosticsDto): ExtensionPullRequestCheckDiagnostics {
		return {
			checkRuns: raw.checkRuns === null ? null : raw.checkRuns.map(checkRunFromRaw),
			checkRunsComplete: raw.checkRunsComplete,
			commitStatuses:
				raw.commitStatuses === null ? null : raw.commitStatuses.map((status) => ({ ...status })),
			commitStatusesComplete: raw.commitStatusesComplete,
			truncated: raw.truncated,
		};
	}
}

function checkRunFromRaw(raw: CheckRunDiagnosticDto): ExtensionPullRequestCheckRunDiagnostic {
	return {
		...raw,
		status: CHECK_RUN_STATUSES.find((status) => status === raw.status) ?? 'pending',
		conclusion:
			raw.conclusion === null
				? null
				: (CHECK_RUN_CONCLUSIONS.find((conclusion) => conclusion === raw.conclusion) ?? 'neutral'),
		annotations:
			raw.annotations === null ? null : raw.annotations.map((annotation) => ({ ...annotation })),
	};
}

function mergeMethod(value: string | null | undefined): ExtensionPullRequestMergeMethod | null {
	return MERGE_METHODS.find((method) => method === value) ?? null;
}
