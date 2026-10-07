import type { SurfacePullRequestState } from './repository-surface';

export type PullRequestState =
	'none' | 'draft' | 'open' | 'ready' | 'failing' | 'merged' | 'closed' | 'unknown';

export type PullRequestTarget = Readonly<{
	workstreamId: string;
	repoId: string;
	head: string;
	base: string;
}>;

export const PULL_REQUEST_STATE_POLL_INTERVAL_MS = 5 * 60_000;

export function settledPullRequestState(state: SurfacePullRequestState): PullRequestState | null {
	if (state === 'merged') return 'merged';
	if (state === 'closed') return 'closed';
	if (state === 'not_open') return 'none';
	return null;
}
export const PULL_REQUEST_STATE_REUSE_MS = PULL_REQUEST_STATE_POLL_INTERVAL_MS / 2;
