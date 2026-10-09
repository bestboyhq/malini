export type WorkstreamStatus = 'active' | 'paused' | 'merged' | 'archived';

export type WorkstreamCheckoutState =
	'healthy' | 'path-diverged' | 'missing' | 'not-a-checkout' | 'unresolvable';

export interface Project {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	createdAt: string;
}

export interface ProjectDto extends Project {
	remoteUrl: string | null;
}

export interface Workstream {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: WorkstreamStatus;
	createdAt: string;
}

export interface WorkstreamDto extends Workstream {
	checkoutState: WorkstreamCheckoutState;
	checkoutIssue: string | null;
	resolvedPath: string | null;
}

export interface GitProjectRecord {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	createdAt: string;
}

export interface GitWorkstreamRecord {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: string;
	createdAt: string;
}

export interface WorkstreamFileEntry {
	path: string;
}

export interface WorktreeChangeTotals {
	additions: number;
	deletions: number;
	files: number;
}

export interface WorkstreamSnapshot {
	patch: string;
	totals: WorktreeChangeTotals;
}

export interface ArchivedWorkDto {
	ref: string;
	uncommitted: boolean;
	commits: number;
}

export interface WorkstreamRetirementReceipt {
	savedWork: ArchivedWorkDto | null;
}

export type WorkstreamBaseSyncOutcome = 'current' | 'advanced' | 'diverged' | 'cancelled';

export type WorktreeOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export interface WorktreeStatus {
	branch: string;
	dirtyPaths: string[];
	conflictedPaths: string[];
	conflictMarkerPaths: string[];
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	mergeInProgress: boolean;
	operationInProgress: WorktreeOperation | null;
	headSha: string | null;
}

export interface WorkstreamImageBytes {
	mediaType: string;
	base64: string;
	size: number;
}

export interface ImportSource {
	kind: 'local-folder' | 'clone-url';
	path?: string;
	url?: string;
}

export interface ConnectedRepositoryDto {
	id: string;
	fullName: string;
	defaultBranch: string;
	localPath: string | null;
	remoteUrl: string | null;
	createdAt: string;
}

export interface GithubRepositoryDto {
	fullName: string;
	description: string | null;
	cloneUrl: string;
}

export interface AuthStatusDto {
	authenticated: boolean;
	installed: boolean;
	login: string | null;
	host: string;
	message: string | null;
}

export interface OwnerAvatar {
	mediaType: string;
	base64: string;
}

export interface PullRequestCheckDto {
	name: string;
	appId: number | null;
	state: string;
	conclusion: string | null;
	required: boolean | null;
	url: string | null;
	startedAt: string | null;
	completedAt: string | null;
	notStartedReason: string | null;
}

export interface PullRequestStatusDto {
	state: 'not_open' | 'open' | 'closed' | 'merged';
	number: number | null;
	url: string | null;
	title: string | null;
	draft: boolean | null;
	headRef: string;
	baseRef: string;
	headSha: string | null;
	includesLocalHead: boolean | null;
	mergeable: boolean | null;
	mergeableState: string | null;
	behindBase: number | null;
	checksState: 'none' | 'success' | 'pending' | 'failed' | 'unknown';
	checks: PullRequestCheckDto[];
	viewerCanMerge: boolean | null;
	allowedMergeMethods: string[];
	defaultMergeMethod: string | null;
	reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
	unresolvedReviewThreadCount: number | null;
	updatedAt: string | null;
}

export interface PullRequestMetadataDto {
	title: string | null;
	body: string | null;
}

export interface CheckAnnotationDto {
	path: string;
	startLine: number;
	endLine: number;
	startColumn: number | null;
	endColumn: number | null;
	level: 'notice' | 'warning' | 'failure';
	title: string | null;
	message: string;
	rawDetails: string | null;
}

export interface CheckRunDiagnosticDto {
	id: number;
	name: string;
	appId: number;
	status: string;
	conclusion: string | null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	outputTitle: string | null;
	outputSummary: string | null;
	outputText: string | null;
	annotationsCount: number;
	annotations: CheckAnnotationDto[] | null;
	annotationsComplete: boolean;
	logExcerpt: string | null;
}

export interface CommitStatusDiagnosticDto {
	id: number;
	context: string;
	state: 'failure' | 'error';
	description: string | null;
	targetUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CheckDiagnosticsDto {
	checkRuns: CheckRunDiagnosticDto[] | null;
	checkRunsComplete: boolean;
	commitStatuses: CommitStatusDiagnosticDto[] | null;
	commitStatusesComplete: boolean;
	truncated: boolean;
}

export interface ReviewCommentDto {
	id: string;
	authorLogin: string | null;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface ReviewThreadDto {
	id: string;
	path: string;
	line: number | null;
	startLine: number | null;
	side: 'LEFT' | 'RIGHT';
	startSide: 'LEFT' | 'RIGHT' | null;
	subjectType: 'LINE' | 'FILE';
	outdated: boolean;
	comments: ReviewCommentDto[];
}

export interface RequestedChangeReviewDto {
	id: string;
	authorLogin: string | null;
	body: string;
	submittedAt: string;
	updatedAt: string;
}

export interface AddressedReviewThreadsDto {
	resolvedThreadIds: string[];
	failures: string[];
}

export interface ReviewFeedbackDto {
	unresolvedThreads: ReviewThreadDto[] | null;
	unresolvedThreadsComplete: boolean;
	requestedChangeReviews: RequestedChangeReviewDto[] | null;
	requestedChangeReviewsComplete: boolean;
	truncated: boolean;
}
