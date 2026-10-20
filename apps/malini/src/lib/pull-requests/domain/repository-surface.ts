import type { WorktreeOperation } from '$contract/repositories';
import type { PullRequestActivity } from '$shared/repositories/domain/workstream-freshness';
import type { PullRequestAvailability } from './pull-request-action';
import type {
	PullRequestChecksState,
	PullRequestMergeMethod,
	PullRequestReviewDecision,
} from './pull-request';

export type RepositorySurfaceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type RepositorySurfaceRefreshStatus = 'idle' | 'loading' | 'ready' | 'error';

export type RepositorySurfaceTodoStatus = 'loading' | 'ready' | 'error';

export type SurfacePullRequestState =
	'not_open' | 'draft' | 'open' | 'merged' | 'closed' | 'unavailable';

export type SurfacePullRequestMergeReadiness = 'ready' | 'behind' | 'blocked' | 'checking';

export type SurfacePullRequestCheck = Readonly<{
	name: string;
	appId: number | null;
	state: string;
	conclusion: string | null;
	required: boolean | null;
	passed: boolean;
	failed: boolean;
	notStartedReason: string | null;
}>;

export type SurfacePullRequest = Readonly<{
	state: SurfacePullRequestState;
	number: number | null;
	url: string | null;
	headSha: string | null;
	githubLagsPush: boolean;
	mergeable: boolean | null;
	mergeableState: string | null;
	behindBase: number | null;
	checks: PullRequestChecksState;
	checksHeadline: string;
	checkItems: readonly SurfacePullRequestCheck[];
	reviewDecision: PullRequestReviewDecision | null;
	unresolvedReviewThreadCount: number | null;
	reviewStatusUnavailable: boolean;
	viewerCanMerge: boolean | null;
	mergeReadiness: SurfacePullRequestMergeReadiness;
	mergeMethod: PullRequestMergeMethod | null;
}>;

export type GithubStatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export type GithubStatusCheckRow = Readonly<{
	id: string;
	name: string;
	detail: string;
	tone: GithubStatusTone;
	blocking: boolean;
	url: string | null;
}>;

export type GithubStatusNote = Readonly<{
	label: string;
	tone: GithubStatusTone;
}>;

export type GithubSession = 'usable' | 'reconnect-required';

export type GithubStatus = Readonly<{
	session: GithubSession;
	reference: string | null;
	refreshing: boolean;
	title: string | null;
	branch: string | null;
	url: string | null;
	checks: readonly GithubStatusCheckRow[];
	checksSummary: string;
	review: GithubStatusNote | null;
	todos: GithubStatusNote | null;
	changes: GithubStatusNote | null;
}>;

export type RepositorySurface = Readonly<{
	status: RepositorySurfaceStatus;
	workstreamId: string | null;
	branch: string | null;
	baseBranch: string | null;
	dirtyPaths: readonly string[];
	conflictedPaths: readonly string[];
	conflictMarkerPaths: readonly string[];
	changedFiles: number;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	mergeInProgress: boolean;
	operationInProgress: WorktreeOperation | null;
	pullRequest: SurfacePullRequest | null;
	pullRequestRefreshStatus: RepositorySurfaceRefreshStatus;
	pullRequestRefreshedAt: number | null;
	pullRequestSettledAt: number | null;
	localError: string | null;
	pullRequestError: string | null;
	error: string | null;
	todoStatus: RepositorySurfaceTodoStatus;
	todoOpenCount: number;
	todoError: string | null;
	github: GithubStatus | null;
}>;

export type RepositoryCommandOutcome = Readonly<{
	surface: RepositorySurface;
}>;

export function surfaceGithubStatus(
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
): GithubStatus | null {
	if (availability === 'github-unavailable' || availability === 'extension-unavailable')
		return null;
	return surface?.github ?? null;
}

export function repositorySurfaceHasBeenRead(surface: RepositorySurface): boolean {
	if (surface.status === 'idle') return false;
	if (surface.status !== 'loading' && surface.pullRequestRefreshStatus !== 'loading') return true;
	return surface.pullRequestRefreshedAt !== null;
}

const RUNNING_CHECK_STATES: ReadonlySet<string> = new Set([
	'pending',
	'queued',
	'in_progress',
	'waiting',
	'requested',
	'expected',
]);

export function pullRequestRefreshActivity(surface: RepositorySurface | null): PullRequestActivity {
	const pullRequest = surface?.pullRequest;
	if (pullRequest?.state === 'merged' || pullRequest?.state === 'closed') return 'finished';
	if (pullRequest?.state !== 'open' && pullRequest?.state !== 'draft') return 'idle';
	const awaitingGithub =
		pullRequest.githubLagsPush ||
		pullRequest.checks === 'pending' ||
		pullRequest.mergeableState?.toLowerCase() === 'unknown' ||
		pullRequest.checkItems.some(
			(check) => check.conclusion === null && RUNNING_CHECK_STATES.has(check.state.toLowerCase()),
		);
	return awaitingGithub ? 'running' : 'idle';
}

export type RepositorySurfaceLoad = 'loading' | 'loaded' | 'failed';

export type RepositorySurfaceReadState = 'reading' | 'settled' | 'failed';

export function repositorySurfaceReadState(
	latest: RepositorySurface | null,
	load: RepositorySurfaceLoad | null,
): RepositorySurfaceReadState {
	if (load === 'failed' || latest?.status === 'error') return 'failed';
	if (latest === null) return load === 'loading' ? 'reading' : 'settled';
	if (latest.status === 'loading' || latest.pullRequestRefreshStatus === 'loading') {
		return 'reading';
	}
	return 'settled';
}
