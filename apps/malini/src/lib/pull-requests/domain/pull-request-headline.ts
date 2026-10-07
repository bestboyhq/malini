import { pullRequestConflictsWithBase, surfaceBlockingChecks } from './pull-request-top-bar';
import type { RepositorySurface, SurfacePullRequest } from './repository-surface';

export type PullRequestHeadlineTone =
	'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'merged';

export type PullRequestHeadline = Readonly<{
	label: string;
	tone: PullRequestHeadlineTone;
}>;

export function pullRequestHeadline(surface: RepositorySurface | null): PullRequestHeadline | null {
	const pullRequest = surface?.pullRequest;
	if (!surface || !pullRequest || pullRequest.number === null) return null;
	if (pullRequest.state === 'merged') return { label: 'Merged', tone: 'merged' };
	if (pullRequest.state === 'closed') return { label: 'Closed', tone: 'neutral' };
	if (pullRequest.state === 'draft') return { label: 'Draft', tone: 'neutral' };
	if (pullRequest.state !== 'open') return null;
	return openHeadline(surface, pullRequest);
}

function openHeadline(
	surface: RepositorySurface,
	pullRequest: SurfacePullRequest,
): PullRequestHeadline {
	if (pullRequestConflictsWithBase(pullRequest) || surface.conflictMarkerPaths.length > 0) {
		return { label: 'Merge conflicts', tone: 'danger' };
	}
	if (pullRequest.githubLagsPush) return { label: 'Waiting for GitHub…', tone: 'progress' };

	const checks = pullRequest.checkItems;
	const failing = surfaceBlockingChecks(checks).filter((check) => check.failed).length;
	if (failing > 0) return { label: `${checkCount(failing)} failed`, tone: 'danger' };
	if (pullRequest.reviewDecision === 'changes_requested') {
		return { label: 'Changes requested', tone: 'danger' };
	}
	const threads = pullRequest.unresolvedReviewThreadCount ?? 0;
	if (threads > 0) {
		return {
			label: `${threads} unresolved thread${threads === 1 ? '' : 's'}`,
			tone: 'danger',
		};
	}

	const pending = checks.filter(
		(check) => !check.passed && !check.failed && !check.notStartedReason,
	).length;
	if (pending > 0) return { label: `${checkCount(pending)} pending…`, tone: 'progress' };
	if (pullRequest.checks === 'pending') return { label: 'Waiting for checks…', tone: 'progress' };
	if (checks.some((check) => check.notStartedReason)) {
		return { label: "CI didn't start", tone: 'warning' };
	}
	if (pullRequest.checks === 'failed') return { label: 'Checks failed', tone: 'danger' };

	const mergeState = pullRequest.mergeableState?.trim().toLocaleLowerCase();
	if (surface.behind > 0 || mergeState === 'behind') {
		return { label: `Behind ${surface.baseBranch ?? 'its base'}`, tone: 'warning' };
	}
	if (pullRequest.reviewDecision === 'review_required') {
		return { label: 'Review required', tone: 'warning' };
	}

	const optionalFailures = checks.filter((check) => check.required === false && check.failed);
	if (optionalFailures.length > 0) {
		return {
			label: `${optionalFailures.length} optional ${optionalFailures.length === 1 ? 'check' : 'checks'} failed`,
			tone: 'success',
		};
	}
	if (checks.length > 0 || pullRequest.checks === 'success') {
		return { label: 'Checks passed', tone: 'success' };
	}
	return { label: 'Open', tone: 'neutral' };
}

function checkCount(count: number): string {
	return `${count} ${count === 1 ? 'check' : 'checks'}`;
}
