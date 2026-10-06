export type PullRequestState =
	'none' | 'draft' | 'open' | 'ready' | 'failing' | 'merged' | 'closed' | 'unknown';

export type PullRequestTarget = Readonly<{
	workstreamId: string;
	repoId: string;
	head: string;
	base: string;
}>;

export const PULL_REQUEST_STATE_POLL_INTERVAL_MS = 5 * 60_000;
export const PULL_REQUEST_STATE_REUSE_MS = PULL_REQUEST_STATE_POLL_INTERVAL_MS / 2;
