export type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';

export type ShipStep =
	| 'waiting-for-agent'
	| 'opening-draft'
	| 'pushing'
	| 'marking-ready'
	| 'updating-branch'
	| 'updating-from-main'
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
	pullRequestNumber: number | null;
	pullRequestUrl: string | null;
	needsYou: ShipNeedsYou | null;
	queuedAt: string | null;
	attempts: number;
	activeJobRunId: string | null;
	lastError: string | null;
	nextAttemptAt: string | null;
	updatedAt: string;
}>;

export type ShipWorkstreamArgs = Readonly<{ workstreamId: string }>;

export type ReopenPullRequestArgs = Readonly<{ workstreamId: string; pullRequestNumber: number }>;

export type ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;

export type ShipChangedEvent = Readonly<{
	workstreamId: string;
	state: ShipStateRecord | null;
	merged?: ShipMerged;
}>;

export const MERGE_QUEUE_FIX_ATTEMPTS_SETTING = 'merge-queue.fix-attempts';

export const DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS = 3;

export const MERGE_QUEUE_FIX_ATTEMPTS_RANGE = Object.freeze({ min: 1, max: 20 });
