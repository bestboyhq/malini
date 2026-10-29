export type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';

export type ShipStep =
	| 'waiting-for-agent'
	| 'opening-draft'
	| 'pushing'
	| 'marking-ready'
	| 'updating-branch'
	| 'updating-from-main'
	| 'resolving-conflicts'
	| 'fixing-checks'
	| 'addressing-review'
	| 'waiting-for-checks'
	| 'waiting-for-review'
	| 'waiting-for-github'
	| 'merging'
	| 'archiving';

export type ShipNeedsYouReason =
	| 'reply-to-reviewer'
	| 'fix-gave-up'
	| 'merge-not-permitted'
	| 'pull-request-closed'
	| 'github-reconnect'
	| 'operation-in-progress';

export type ShipNeedsYou = Readonly<{
	reason: ShipNeedsYouReason;
	detail: string;
	jobRunId: string | null;
}>;

export type ShipStateRecord = Readonly<{
	workstreamId: string;
	phase: ShipPhase;
	step: ShipStep | null;
	keep: boolean;
	pullRequestNumber: number | null;
	pullRequestUrl: string | null;
	needsYou: ShipNeedsYou | null;
	queuedAt: string | null;
	attempts: number;
	activeJobRunId: string | null;
	lastError: string | null;
	githubSaid: string | null;
	failures: number;
	failedSince: string | null;
	nextAttemptAt: string | null;
	updatedAt: string;
}>;

export type ShipFailure = Readonly<{
	stage: 'draft' | 'merge';
	label: string;
	title: string;
	reason: string;
	githubSaid: string | null;
	tries: number;
	since: string;
	nextTry: string | null;
}>;

export type ShipWorkstreamArgs = Readonly<{ workstreamId: string }>;

export type ReopenPullRequestArgs = Readonly<{ workstreamId: string; pullRequestNumber: number }>;

export type ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;

export type ShipChangedEvent = Readonly<{
	workstreamId: string;
	state: ShipStateRecord | null;
	merged?: ShipMerged;
}>;

export type ShipButton = 'draft' | 'merge' | 'retry' | 'cancel' | 'keep';

export const SHIP_BUTTONS: readonly ShipButton[] = ['draft', 'merge', 'retry', 'cancel', 'keep'];

export type ShipAllButton = 'draft-all' | 'merge-all';

export const SHIP_ALL_BUTTONS: readonly ShipAllButton[] = ['draft-all', 'merge-all'];

export type ShipAllClicked = Readonly<{
	workstreamId: string;
	button: ShipAllButton;
	workstreamIds: readonly string[];
	chatSessionId: string | null;
}>;

export type ShipButtonArgs =
	Readonly<{ workstreamId: string; button: ShipButton }> | ShipAllClicked;

export type ShipButtonClickedEvent =
	| Readonly<{
			workstreamId: string;
			button: ShipButton;
			state: ShipStateRecord | null;
	  }>
	| ShipAllClicked;

export type WorkstreamOpenedEvent = Readonly<{ workstreamId: string }>;

export type PullRequestMergeability = 'ready' | 'conflicts' | 'behind' | 'blocked' | 'unknown';

export type PullRequestFailedCheck = Readonly<{
	name: string;
	state: string;
	required: boolean | null;
	appId: number | null;
	completedAt: string | null;
}>;

export type PullRequestReviewItem = Readonly<{ id: string; by: string | null; bot: boolean }>;

export type PullRequestChangedEvent = Readonly<{
	workstreamId: string;
	pullRequestNumber: number;
	pullRequestUrl: string | null;
	state: 'open' | 'draft' | 'closed' | 'merged';
	baseBranch: string;
	headSha: string | null;
	checks: 'none' | 'success' | 'pending' | 'failed' | 'unknown';
	checksPending: boolean;
	failingChecks: readonly string[];
	blockingChecks: readonly PullRequestFailedCheck[];
	reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
	unresolvedThreads: number | null;
	changeRequests: readonly PullRequestReviewItem[] | null;
	threads: readonly PullRequestReviewItem[] | null;
	behindBase: number | null;
	conflicts: boolean;
	mergeability: PullRequestMergeability;
	viewerCanMerge: boolean | null;
	mergeMethod: string | null;
}>;

export const MERGE_QUEUE_FIX_ATTEMPTS_SETTING = 'merge-queue.fix-attempts';

export const DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS = 3;

export const MERGE_QUEUE_FIX_ATTEMPTS_RANGE = Object.freeze({ min: 1, max: 20 });
