export const ACTIVE_WORKSTREAM_TOTALS_REFRESH_INTERVAL_MS = 15_000;

export const ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS = 10_000;

export const ACTIVE_WORKSTREAM_PULL_REQUEST_IDLE_REFRESH_LIMIT_MS = 60_000;

export type ActiveWorkstreamFreshnessPhase = 'idle' | 'deferred' | 'released-after-paint';

export type PullRequestActivity = 'running' | 'idle' | 'finished';

export type ActiveWorkstreamFreshnessRequest = Readonly<{
	totals: boolean;
	localRepository: boolean;
	pullRequest: boolean;
}>;

export type ActiveWorkstreamFreshnessCallbacks = Readonly<{
	ensureTotals?(workstreamId: string): Promise<void> | void;
	refreshTotals(workstreamId: string): Promise<void> | void;
	refreshLocalRepository(workstreamId: string): Promise<void> | void;
	refreshPullRequest(workstreamId: string): Promise<void> | void;
	pullRequestActivity?(workstreamId: string): PullRequestActivity;
}>;

export type ActiveWorkstreamFreshnessOptions = Readonly<{
	totalsIntervalMs?: number;
	pullRequestIntervalMs?: number;
	now?: () => number;
	isForeground?: () => boolean;
	subscribeForeground?: (listener: () => void) => () => void;
}>;

export function pullRequestRefreshIsDue(
	activity: PullRequestActivity,
	idleRefreshes: number,
	sinceLastRefreshMs: number,
	intervalMs: number,
): boolean {
	if (activity === 'finished') return false;
	if (activity === 'running') return true;
	const backoff = intervalMs * 2 ** (idleRefreshes + 1);
	return (
		sinceLastRefreshMs >= Math.min(ACTIVE_WORKSTREAM_PULL_REQUEST_IDLE_REFRESH_LIMIT_MS, backoff)
	);
}
