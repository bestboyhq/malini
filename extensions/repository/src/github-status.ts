import {
	formatCount,
	type ExtensionPullRequestCheck,
	type ExtensionPullRequestContext,
} from '@malini/extension-api';
import type { RepositorySurfaceState } from './controller.js';
import {
	pullRequestCheckFailed,
	pullRequestCheckPassed,
	pullRequestHasReviewBlockers,
	pullRequestReviewStatusUnavailable,
	repositoryGithubSession,
	type RepositoryGithubSession,
} from './domain.js';
import { upstreamPositionSummary } from './upstream-position.js';

export type RepositoryGithubStatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export type RepositoryGithubAvailability =
	'checking' | 'ready' | 'github-unavailable' | 'extension-unavailable';

export type RepositoryGithubCheckRow = Readonly<{
	id: string;
	name: string;
	detail: string;
	tone: RepositoryGithubStatusTone;
	blocking: boolean;
	url: string | null;
}>;

export type RepositoryGithubStatusNote = Readonly<{
	label: string;
	tone: RepositoryGithubStatusTone;
}>;

export type RepositoryGithubStatus = Readonly<{
	session: RepositoryGithubSession;
	reference: string | null;
	refreshing: boolean;
	title: string | null;
	branch: string | null;
	url: string | null;
	checks: readonly RepositoryGithubCheckRow[];
	checksSummary: string;
	review: RepositoryGithubStatusNote | null;
	todos: RepositoryGithubStatusNote | null;
	changes: RepositoryGithubStatusNote | null;
}>;

export function repositoryGithubStatus(
	state: RepositorySurfaceState | null,
	availability: RepositoryGithubAvailability = 'ready',
): RepositoryGithubStatus | null {
	if (availability !== 'ready' && availability !== 'checking') return null;
	if (!state || state.status === 'idle') return null;
	if (availability === 'checking' && !state.pullRequest) return null;

	const pullRequest = state.pullRequest;
	if (pullRequest?.state === 'unavailable') return null;

	const checks = checkRows(pullRequest);
	return {
		session: repositoryGithubSession(state.error, state.pullRequestError, state.localError),
		reference: pullRequest?.number ? `#${pullRequest.number}` : null,
		refreshing: state.status === 'loading' || state.pullRequestRefreshStatus === 'loading',
		title: pullRequest?.title?.trim() || null,
		branch: branchLabel(state),
		url: pullRequest?.url ?? null,
		checks,
		checksSummary: checksSummary(pullRequest, checks),
		review: reviewNote(pullRequest),
		todos: todoNote(state, pullRequest),
		changes: changesNote(state),
	};
}

function changesNote(state: RepositorySurfaceState): RepositoryGithubStatusNote | null {
	const parts = [
		state.dirtyPaths.length > 0 ? `${formatCount(state.dirtyPaths.length)} uncommitted` : '',
		upstreamPositionSummary(state),
	].filter(Boolean);
	if (parts.length === 0) return null;
	const local = state.dirtyPaths.length > 0 || state.ahead > 0;
	return { label: parts.join(' · '), tone: local ? 'warning' : 'neutral' };
}

function checkRows(
	pullRequest: ExtensionPullRequestContext | null,
): readonly RepositoryGithubCheckRow[] {
	const items = pullRequest?.checkItems ?? [];
	const rows = items.map((check, index) => ({
		id: `${check.name}${check.appId ?? ''}${index}`,
		name: check.name,
		detail: checkDetail(check),
		tone: checkTone(check),
		blocking: check.required !== false && !pullRequestCheckPassed(check),
		url: check.url,
	}));
	return [...rows].sort((left, right) => Number(right.blocking) - Number(left.blocking));
}

function checkDetail(check: ExtensionPullRequestCheck): string {
	const requirement = check.required === false ? 'optional' : null;
	if (check.notStartedReason) return ["Didn't start", requirement].filter(Boolean).join(' · ');
	const result = checkResultLabel(check.conclusion ?? check.state);
	const duration = pullRequestCheckDurationLabel(check.startedAt, check.completedAt);
	return [result, duration, requirement].filter(Boolean).join(' · ');
}

const CHECK_RESULT_WORDS: Readonly<Record<string, string>> = {
	success: 'passed',
	failure: 'failed',
	in_progress: 'running',
};

function checkResultLabel(result: string): string {
	const value = result.trim().toLocaleLowerCase();
	const words = CHECK_RESULT_WORDS[value] ?? value.replaceAll('_', ' ');
	return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function checkTone(check: ExtensionPullRequestCheck): RepositoryGithubStatusTone {
	if (pullRequestCheckPassed(check)) return 'success';
	if (pullRequestCheckFailed(check)) return 'danger';
	const state = check.state.trim().toLocaleLowerCase();
	if (['pending', 'queued', 'in_progress', 'waiting', 'requested', 'expected'].includes(state)) {
		return 'progress';
	}
	return 'warning';
}

export function pullRequestChecksHeadline(pullRequest: ExtensionPullRequestContext | null): string {
	if (!pullRequest || pullRequest.state === 'not_open') return 'No checks yet';
	if (pullRequest.checks === 'unknown') return 'Checks unavailable';
	if (pullRequest.checks === 'none') return 'No checks configured';
	if (pullRequest.checks === 'pending') return 'Checks running';
	if (pullRequest.checks === 'failed') return 'Checks failed';
	return 'Checks passed';
}

function checksSummary(
	pullRequest: ExtensionPullRequestContext | null,
	rows: readonly RepositoryGithubCheckRow[],
): string {
	if (rows.length === 0) return pullRequestChecksHeadline(pullRequest);
	const passed = rows.filter((row) => row.tone === 'success').length;
	const failing = rows.filter((row) => row.tone === 'danger').length;
	const running = rows.filter((row) => row.tone === 'progress').length;
	const notStarted = (pullRequest?.checkItems ?? []).filter(
		(check) => check.notStartedReason,
	).length;
	const unknown = rows.length - passed - failing - running - notStarted;
	return [
		passed > 0 ? `${passed} passed` : '',
		failing > 0 ? `${failing} failing` : '',
		running > 0 ? `${running} running` : '',
		notStarted > 0 ? `${notStarted} didn't start` : '',
		unknown > 0 ? `${unknown} unknown` : '',
	]
		.filter(Boolean)
		.join(' · ');
}

function reviewNote(
	pullRequest: ExtensionPullRequestContext | null,
): RepositoryGithubStatusNote | null {
	if (!pullRequest || (pullRequest.state !== 'open' && pullRequest.state !== 'draft')) return null;
	if (pullRequestReviewStatusUnavailable(pullRequest)) {
		return { label: 'Review status unavailable', tone: 'warning' };
	}
	const threads = pullRequest.unresolvedReviewThreadCount ?? 0;
	if (threads > 0) {
		return {
			label: `${threads} unresolved thread${threads === 1 ? '' : 's'}`,
			tone: 'danger',
		};
	}
	if (pullRequest.reviewDecision === 'changes_requested') {
		return { label: 'Changes requested', tone: 'danger' };
	}
	if (pullRequest.reviewDecision === 'review_required') {
		return { label: 'Review required', tone: 'warning' };
	}
	if (pullRequest.reviewDecision === 'approved') {
		return { label: 'Approved', tone: 'success' };
	}
	if (pullRequestHasReviewBlockers(pullRequest)) {
		return { label: 'Review required', tone: 'warning' };
	}
	return null;
}

function todoNote(
	state: RepositorySurfaceState,
	pullRequest: ExtensionPullRequestContext | null,
): RepositoryGithubStatusNote | null {
	if (!pullRequest || (pullRequest.state !== 'open' && pullRequest.state !== 'draft')) return null;
	if (state.todoStatus !== 'ready') {
		return { label: 'Todos unavailable', tone: 'warning' };
	}
	if (state.todoOpenCount > 0) {
		return {
			label: `${state.todoOpenCount} open todo${state.todoOpenCount === 1 ? '' : 's'}`,
			tone: 'warning',
		};
	}
	return null;
}

function branchLabel(state: RepositorySurfaceState): string | null {
	if (!state.branch) return null;
	return state.baseBranch ? `${state.branch} → ${state.baseBranch}` : state.branch;
}

export function pullRequestCheckDurationLabel(
	startedAt: string | null,
	completedAt: string | null,
): string | null {
	if (!startedAt || !completedAt) return null;
	const started = Date.parse(startedAt);
	const completed = Date.parse(completedAt);
	if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
	const seconds = Math.floor((completed - started) / 1_000);
	if (seconds < 1) return '<1s';
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	if (hours >= 100) return '99h+';
	return `${hours}h ${minutes % 60}m`;
}
