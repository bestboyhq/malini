export type PullRequestLifecycle = 'not_open' | 'open' | 'closed' | 'merged';
export type PullRequestChecksState = 'none' | 'success' | 'pending' | 'failed' | 'unknown';
export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';
export type PullRequestReviewDecision = 'approved' | 'changes_requested' | 'review_required';

export type PullRequestCheck = Readonly<{
	name: string;
	appId: number | null;
	state: string;
	conclusion: string | null;
	required: boolean | null;
	url: string | null;
	startedAt: string | null;
	completedAt: string | null;
}>;

export type PullRequestStatus = {
	state: PullRequestLifecycle;
	number: number | null;
	url: string | null;
	title: string | null;
	draft: boolean | null;
	headRef: string;
	baseRef: string;
	headSha: string | null;
	mergeable: boolean | null;
	mergeableState: string | null;
	checksState: PullRequestChecksState;
	checks: readonly PullRequestCheck[];
	viewerCanMerge: boolean | null;
	allowedMergeMethods: readonly PullRequestMergeMethod[];
	defaultMergeMethod: PullRequestMergeMethod | null;
	reviewDecision: PullRequestReviewDecision | null;
	unresolvedReviewThreadCount: number | null;
	updatedAt: string | null;
};

export type PullRequestReviewComment = Readonly<{
	id: string;
	authorLogin: string | null;
	body: string;
	createdAt: string;
	updatedAt: string;
}>;

export type PullRequestReviewThread = Readonly<{
	id: string;
	path: string;
	line: number | null;
	startLine: number | null;
	side: 'LEFT' | 'RIGHT';
	startSide: 'LEFT' | 'RIGHT' | null;
	subjectType: 'LINE' | 'FILE';
	outdated: boolean;
	comments: readonly PullRequestReviewComment[];
}>;

export type PullRequestRequestedChangeReview = Readonly<{
	id: string;
	authorLogin: string | null;
	body: string;
	submittedAt: string;
	updatedAt: string;
}>;

export type PullRequestReviewFeedback = Readonly<{
	unresolvedThreads: readonly PullRequestReviewThread[] | null;
	unresolvedThreadsComplete: boolean;
	requestedChangeReviews: readonly PullRequestRequestedChangeReview[] | null;
	requestedChangeReviewsComplete: boolean;
	truncated: boolean;
}>;

export type PullRequestCheckAnnotation = Readonly<{
	path: string;
	startLine: number;
	endLine: number;
	startColumn: number | null;
	endColumn: number | null;
	level: 'notice' | 'warning' | 'failure';
	title: string | null;
	message: string;
	rawDetails: string | null;
}>;

export type PullRequestCheckRunDiagnostic = Readonly<{
	id: number;
	name: string;
	appId: number;
	status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending' | 'requested';
	conclusion:
		| 'action_required'
		| 'cancelled'
		| 'failure'
		| 'neutral'
		| 'success'
		| 'skipped'
		| 'stale'
		| 'timed_out'
		| 'startup_failure'
		| null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	outputTitle: string | null;
	outputSummary: string | null;
	outputText: string | null;
	annotationsCount: number;
	annotations: readonly PullRequestCheckAnnotation[] | null;
	annotationsComplete: boolean;
	logExcerpt: string | null;
}>;

export type PullRequestCommitStatusDiagnostic = Readonly<{
	id: number;
	context: string;
	state: 'failure' | 'error';
	description: string | null;
	targetUrl: string | null;
	createdAt: string;
	updatedAt: string;
}>;

export type PullRequestCheckDiagnostics = Readonly<{
	checkRuns: readonly PullRequestCheckRunDiagnostic[] | null;
	checkRunsComplete: boolean;
	commitStatuses: readonly PullRequestCommitStatusDiagnostic[] | null;
	commitStatusesComplete: boolean;
	truncated: boolean;
}>;
