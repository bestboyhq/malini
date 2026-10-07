import type { PullRequestState } from './pull-request-state';

const PUBLISHED_PULL_REQUEST_LABELS: Readonly<Partial<Record<PullRequestState, string>>> = {
	draft: 'Ready for review',
	open: 'Open PR',
	failing: 'Fix errors',
	ready: 'Merge',
};

export function pullRequestPlaceholderLabel(
	state: PullRequestState,
	hasBranchChanges: boolean,
): string | null {
	return PUBLISHED_PULL_REQUEST_LABELS[state] ?? (hasBranchChanges ? 'Commit and push' : null);
}
