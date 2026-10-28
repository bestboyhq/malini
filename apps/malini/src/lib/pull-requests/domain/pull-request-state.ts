import { needsYouReasonLabel, type PullRequestShip } from './pull-request-ship';
import type { RepositorySurface, SurfacePullRequest } from './repository-surface';
import { shipFailure } from './ship-failure';

export type PullRequestState = 'none' | 'draft' | 'open' | 'merged' | 'closed' | 'unknown';

export type PullRequestPhase =
	'none' | 'draft' | 'open' | 'queued' | 'needs-you' | 'merged' | 'unknown';

export type PullRequestBadge = Readonly<{
	phase: PullRequestPhase;
	label: string | null;
}>;

export type PullRequestTarget = Readonly<{
	workstreamId: string;
	repoId: string;
	head: string;
	base: string;
}>;

export const PULL_REQUEST_STATE_POLL_INTERVAL_MS = 5 * 60_000;

export const PULL_REQUEST_STATE_REUSE_MS = PULL_REQUEST_STATE_POLL_INTERVAL_MS / 2;

export function pullRequestStateOf(pullRequest: SurfacePullRequest | null): PullRequestState {
	switch (pullRequest?.state) {
		case 'not_open':
			return 'none';
		case 'draft':
		case 'open':
		case 'merged':
		case 'closed':
			return pullRequest.state;
		default:
			return 'unknown';
	}
}

export function observedPullRequestState(surface: RepositorySurface): PullRequestState | null {
	if (surface.pullRequestRefreshStatus !== 'ready') return null;
	const state = pullRequestStateOf(surface.pullRequest);
	return state === 'unknown' ? null : state;
}

export function pullRequestBadge(
	ship: PullRequestShip | null,
	state: PullRequestState,
): PullRequestBadge {
	const failure = state === 'merged' ? null : shipFailure(ship);
	if (failure) return { phase: 'needs-you', label: `Needs you · ${failure.label}` };
	if (ship?.phase === 'queued') return { phase: 'queued', label: 'Merge queued' };
	if (ship?.phase === 'needs-you') {
		const reason = ship.needsYou?.reason;
		return {
			phase: 'needs-you',
			label: reason ? `Needs you · ${needsYouReasonLabel(reason, null)}` : 'Needs you',
		};
	}
	if (ship?.phase === 'draft' && (state === 'none' || state === 'draft' || state === 'unknown')) {
		return {
			phase: 'draft',
			label: ship.pullRequestNumber === null ? 'Opening draft' : 'Draft pull request',
		};
	}
	return STATE_BADGES[state];
}

const STATE_BADGES: Readonly<Record<PullRequestState, PullRequestBadge>> = {
	none: { phase: 'none', label: 'No pull request' },
	closed: { phase: 'none', label: 'Pull request closed' },
	draft: { phase: 'draft', label: 'Draft pull request' },
	open: { phase: 'open', label: 'Pull request open' },
	merged: { phase: 'merged', label: 'Merged' },
	unknown: { phase: 'unknown', label: null },
};
