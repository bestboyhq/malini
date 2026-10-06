import type { WorktreeOperation } from '$contract/repositories';
import {
	worktreeOperationNoun,
	type PullRequestAvailability,
	type PullRequestTopBarPresentation,
} from './pull-request-action';
import type { PullRequestMergeMethod } from './pull-request';
import {
	repositorySurfaceHasBeenRead,
	type RepositorySurface,
	type SurfacePullRequest,
	type SurfacePullRequestCheck,
} from './repository-surface';

export function pullRequestTopBarPresentation(
	state: RepositorySurface | null,
	availability: PullRequestAvailability,
): PullRequestTopBarPresentation | null {
	return topBarPresentation(state, availability);
}

export function pullRequestFixIsActionable(state: RepositorySurface): boolean {
	return topBarPresentation(state, 'ready')?.kind === 'fix';
}

export function pullRequestConflictsWithBase(pullRequest: SurfacePullRequest | null): boolean {
	return (
		publishedPullRequest(pullRequest) &&
		pullRequest?.mergeableState?.trim().toLocaleLowerCase() === 'dirty'
	);
}

export function surfaceBlockingChecks(
	checkItems: readonly SurfacePullRequestCheck[],
): readonly SurfacePullRequestCheck[] {
	return checkItems.filter((check) => check.required !== false && !check.passed);
}

type NextAction = Omit<PullRequestTopBarPresentation, 'remoteFailure'>;

function resting(action: NextAction): PullRequestTopBarPresentation {
	return { ...action, remoteFailure: null };
}

function topBarPresentation(
	state: RepositorySurface | null,
	availability: PullRequestAvailability,
): PullRequestTopBarPresentation | null {
	if (availability === 'github-unavailable') {
		return resting(
			unavailable(
				'Connect GitHub',
				'Connecting GitHub…',
				'Connect GitHub to publish this workstream',
				'Connect this workstream to a GitHub repository to create a pull request',
			),
		);
	}

	if (availability === 'extension-unavailable') {
		return resting(
			unavailable(
				'Enable Repository',
				'Enabling Repository…',
				'Enable the Repository extension for pull request actions',
				'Enable the Repository extension to create or update a pull request',
			),
		);
	}

	if (!state || !repositorySurfaceHasBeenRead(state)) return null;

	if (availability === 'agent-running') return resting(agentRunning());

	const pullRequest = state.pullRequest;
	if (pullRequest?.state === 'unavailable') {
		return resting(
			unavailable(
				'Connect GitHub',
				'Connecting GitHub…',
				'Connect the repository GitHub account',
				'Connect the repository GitHub account to create or update a pull request',
			),
		);
	}

	if (state.localError) return resting(retry(state.localError, pullRequest?.number ?? null));

	if (githubSessionFinished(state)) return resting(reconnect());

	const remoteFailure = pullRequestReadFailure(state);

	const worktreeVerb = worktreeOnlyNextAction(state, pullRequest);
	if (worktreeVerb) return { ...worktreeVerb, remoteFailure };

	if (remoteFailure) {
		return resting(retry(remoteFailure, pullRequest?.number ?? null));
	}

	if (state.status === 'loading' || state.pullRequestRefreshStatus === 'loading') {
		return topBarPresentation(
			{
				...state,
				status: state.status === 'loading' ? 'ready' : state.status,
				pullRequestRefreshStatus: 'ready',
			},
			'ready',
		);
	}

	return resting(pullRequestNextAction(state, pullRequest));
}

function pullRequestReadFailure(state: RepositorySurface): string | null {
	if (state.pullRequestError) return state.pullRequestError;
	if (state.pullRequestRefreshStatus === 'error') return 'Pull request status is unavailable';
	return null;
}

function worktreeOnlyNextAction(
	state: RepositorySurface,
	pullRequest: SurfacePullRequest | null,
): NextAction | null {
	const operation = state.operationInProgress;
	if (operation !== null && operation !== 'merge') return operationInProgress(operation);

	if (state.conflictMarkerPaths.length > 0) {
		return fix(
			'Resolve conflicts',
			'Resolving conflicts…',
			pullRequestNumberLabel('Resolve merge conflicts', pullRequest?.number),
			conflictTooltip(state),
		);
	}

	if (
		operation === 'merge' ||
		state.dirtyPaths.length > 0 ||
		(state.ahead > 0 && !nothingToShip(state, pullRequest))
	) {
		return push(state, pullRequest);
	}

	return null;
}

function nothingToShip(state: RepositorySurface, pullRequest: SurfacePullRequest | null): boolean {
	return (
		state.changedFiles === 0 && state.dirtyPaths.length === 0 && !publishedPullRequest(pullRequest)
	);
}

function githubSessionFinished(state: RepositorySurface): boolean {
	return state.github?.session === 'reconnect-required';
}

function pullRequestNextAction(
	state: RepositorySurface,
	pullRequest: SurfacePullRequest | null,
): NextAction {
	const mergeState = pullRequest?.mergeableState?.trim().toLocaleLowerCase() ?? '';

	if (pullRequestConflictsWithBase(pullRequest)) {
		return fix(
			'Resolve conflicts',
			'Resolving conflicts…',
			pullRequestNumberLabel('Resolve merge conflicts', pullRequest?.number),
			conflictTooltip(state),
		);
	}

	const worktreeVerb = worktreeOnlyNextAction(state, pullRequest);
	if (worktreeVerb) return worktreeVerb;

	if (publishedPullRequest(pullRequest) && !state.hasUpstream) {
		return push(state, pullRequest);
	}

	if (pullRequest?.state === 'merged' && state.ahead === 0 && state.dirtyPaths.length === 0) {
		return merged(pullRequest);
	}

	if (nothingToShip(state, pullRequest)) return noChanges();

	if (state.behind > 0 || mergeState === 'behind') {
		return update(state, pullRequest);
	}

	if (
		!pullRequest ||
		pullRequest.state === 'not_open' ||
		pullRequest.state === 'merged' ||
		pullRequest.state === 'closed'
	) {
		return create(pullRequest);
	}

	if (pullRequest.state === 'draft') {
		return {
			kind: 'ready',
			label: 'Ready for review',
			busyLabel: 'Publishing…',
			ariaLabel: pullRequestNumberLabel('Mark pull request ready for review', pullRequest.number),
			tooltip: 'Move this draft pull request into review',
			disabled: false,
			tone: 'primary',
			confirmLabel: null,
			confirmBusyLabel: null,
		};
	}

	return openPullRequestNextAction(state, pullRequest, mergeState);
}

function openPullRequestNextAction(
	state: RepositorySurface,
	pullRequest: SurfacePullRequest,
	mergeState: string,
): NextAction {
	if (pullRequest.githubLagsPush) {
		return checking(pullRequest, 'GitHub has not picked up the latest push yet');
	}

	const checkItems = pullRequest.checkItems;
	const blockingChecks = surfaceBlockingChecks(checkItems);
	const unresolvedThreads = pullRequest.unresolvedReviewThreadCount ?? 0;

	if (unresolvedThreads > 0 || pullRequest.reviewDecision === 'changes_requested') {
		return fix(
			'Fix errors',
			'Fixing errors…',
			pullRequestNumberLabel('Resolve pull request review blockers', pullRequest.number),
			unresolvedThreads > 0
				? `Resolve ${unresolvedThreads} review thread${unresolvedThreads === 1 ? '' : 's'} in this workstream`
				: 'Address requested changes in this workstream before merging',
		);
	}

	if (pullRequest.reviewDecision === 'review_required') {
		return open(
			pullRequest,
			'A required human approval is still outstanding. Open the pull request on GitHub',
		);
	}

	if (pullRequest.reviewStatusUnavailable) {
		return retry(
			'Review thread status is unavailable; retry the remote pull request read',
			pullRequest.number,
		);
	}

	if (pullRequest.checks === 'unknown') {
		return retry(
			'Check status is unavailable; retry the remote pull request read',
			pullRequest.number,
		);
	}

	const failing = blockingChecks.filter((check) => check.failed).length;
	if (failing > 0) {
		return fix(
			'Fix errors',
			'Fixing errors…',
			pullRequestNumberLabel('Fix pull request errors', pullRequest.number),
			`${failing} blocking check${failing === 1 ? '' : 's'} failed; inspect the failures in this workstream`,
		);
	}

	const notStartedReason = blockingChecks.find((check) => check.notStartedReason)?.notStartedReason;
	if (notStartedReason) return ciNotStarted(pullRequest, notStartedReason);

	if (
		(checkItems.length === 0 && pullRequest.checks === 'failed') ||
		pullRequest.mergeable === false ||
		mergeState === 'blocked'
	) {
		return fix(
			'Fix errors',
			'Fixing errors…',
			pullRequestNumberLabel('Fix pull request errors', pullRequest.number),
			pullRequest.checks === 'failed'
				? 'Checks failed; inspect the failures in this workstream and continue the agent'
				: 'The pull request has merge blockers to resolve in this workstream',
		);
	}

	if (blockingChecks.length > 0 || (checkItems.length === 0 && pullRequest.checks === 'pending')) {
		return open(
			pullRequest,
			blockingChecks.length > 0
				? `${blockingChecks.length} required check${blockingChecks.length === 1 ? '' : 's'} still running. Watch ${blockingChecks.length === 1 ? 'it' : 'them'} on GitHub`
				: 'Checks are still running. Watch them on GitHub',
		);
	}

	if (state.todoStatus !== 'ready') {
		return todos(
			pullRequest,
			state.todoError ??
				'Workstream todo state is unavailable; review it in this workstream before merging',
		);
	}

	if (state.todoOpenCount > 0) {
		return todos(
			pullRequest,
			`Complete ${state.todoOpenCount} open workstream todo${state.todoOpenCount === 1 ? '' : 's'} before merging`,
		);
	}

	if (mergeState === 'unknown') {
		return checking(pullRequest, 'GitHub is still working out whether this branch merges cleanly');
	}

	if (pullRequest.mergeReadiness !== 'ready') {
		return retry('GitHub is still computing mergeability; read it again', pullRequest.number);
	}

	if (pullRequest.viewerCanMerge === null || pullRequest.viewerCanMerge === undefined) {
		return retry(
			'Merge permission is unavailable; retry the remote pull request read',
			pullRequest.number,
		);
	}

	if (!pullRequest.headSha) {
		return retry(
			'Pull request head status is unavailable; retry before merging',
			pullRequest.number,
		);
	}

	const mergeMethod = pullRequest.mergeMethod;
	if (pullRequest.viewerCanMerge === false || mergeMethod === null) {
		return open(
			pullRequest,
			pullRequest.viewerCanMerge === false
				? 'You do not have merge permission on this repository. Open the pull request on GitHub'
				: 'No repository merge method is available. Open the pull request on GitHub',
		);
	}

	return {
		kind: 'merge',
		label: 'Merge',
		busyLabel: 'Checking merge…',
		ariaLabel: pullRequestNumberLabel('Merge pull request', pullRequest.number),
		tooltip: `${pullRequest.checksHeadline}. ${mergeMethodInstruction(mergeMethod)}, after one confirming click. Escape cancels it`,
		disabled: false,
		tone: 'primary',
		confirmLabel: 'Confirm merge',
		confirmBusyLabel: 'Merging…',
	};
}

function conflictTooltip(state: RepositorySurface): string {
	const marked = state.conflictMarkerPaths.length;
	if (marked > 0) {
		return `${marked} file${marked === 1 ? ' still has' : 's still have'} conflict markers. Have the agent resolve them, or abort the merge from the pull request menu`;
	}
	return `This branch conflicts with ${state.baseBranch ?? 'its base'}. Merge it into this workstream and have the agent resolve the conflicts`;
}

function publishedPullRequest(pullRequest: SurfacePullRequest | null): boolean {
	return pullRequest?.state === 'open' || pullRequest?.state === 'draft';
}

function push(state: RepositorySurface, pullRequest: SurfacePullRequest | null): NextAction {
	const uncommitted = state.dirtyPaths.length;
	const published = publishedPullRequest(pullRequest);
	const work =
		state.operationInProgress === 'merge'
			? 'Commit the resolved merge and push it'
			: uncommitted > 0
				? `Commit and push ${uncommitted} changed file${uncommitted === 1 ? '' : 's'}`
				: state.hasUpstream
					? `Push ${commitCount(state.ahead)}`
					: 'Push this branch, which does not track a remote yet';
	return {
		kind: 'push',
		label: 'Commit and push',
		busyLabel: 'Pushing…',
		ariaLabel: pullRequestNumberLabel('Commit and push changes', pullRequest?.number),
		tooltip: published ? work : `${work}, then open a pull request`,
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function operationInProgress(operation: Exclude<WorktreeOperation, 'merge'>): NextAction {
	const noun = worktreeOperationNoun(operation);
	return {
		kind: 'operation',
		label: `${noun} in progress`,
		busyLabel: `${noun} in progress`,
		ariaLabel: `${noun} in progress in this workstream`,
		tooltip: `A ${operation} stopped part-way in this workstream. Finish it in a terminal, or abort it from the pull request menu`,
		disabled: true,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function update(state: RepositorySurface, pullRequest: SurfacePullRequest | null): NextAction {
	return {
		kind: 'update',
		label: 'Update branch',
		busyLabel: 'Updating branch…',
		ariaLabel: pullRequestNumberLabel('Update this branch', pullRequest?.number),
		tooltip:
			state.behind > 0
				? `Pull ${commitCount(state.behind)}, push the reconciled branch, and refresh status`
				: 'Pull the target branch, push the result, and refresh checks',
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function create(pullRequest: SurfacePullRequest | null): NextAction {
	const replacing = pullRequest?.state === 'merged' || pullRequest?.state === 'closed';
	return {
		kind: 'create',
		label: 'Create PR',
		busyLabel: 'Creating PR…',
		ariaLabel: replacing ? 'Create a replacement pull request' : 'Create pull request',
		tooltip: replacing
			? 'The previous pull request is closed; open a new one for this branch'
			: 'Push this workstream and open a pull request',
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function todos(pullRequest: SurfacePullRequest, tooltip: string): NextAction {
	return {
		kind: 'todos',
		label: 'Review todos',
		busyLabel: 'Opening todos…',
		ariaLabel: pullRequestNumberLabel('Review open workstream todos', pullRequest.number),
		tooltip,
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function open(pullRequest: SurfacePullRequest, tooltip: string): NextAction {
	return {
		kind: 'open',
		label: 'Open PR',
		busyLabel: 'Opening PR…',
		ariaLabel: pullRequestNumberLabel('Open pull request on GitHub', pullRequest.number),
		tooltip,
		disabled: pullRequest.url === null,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function ciNotStarted(pullRequest: SurfacePullRequest, reason: string): NextAction {
	return {
		...open(pullRequest, `GitHub didn't start CI: ${reason}. Open the pull request on GitHub`),
		label: "CI didn't start",
		ariaLabel: pullRequestNumberLabel(
			"CI didn't start. Open pull request on GitHub",
			pullRequest.number,
		),
	};
}

function merged(pullRequest: SurfacePullRequest): NextAction {
	return {
		...open(
			pullRequest,
			'Everything in this workstream has merged. Open the pull request on GitHub',
		),
		label: 'Merged',
		ariaLabel: pullRequestNumberLabel('Open merged pull request on GitHub', pullRequest.number),
	};
}

function fix(label: string, busyLabel: string, ariaLabel: string, tooltip: string): NextAction {
	return {
		kind: 'fix',
		label,
		busyLabel,
		ariaLabel,
		tooltip,
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function checking(pullRequest: SurfacePullRequest, tooltip: string): NextAction {
	return {
		kind: 'checking',
		label: 'Checking…',
		busyLabel: 'Checking…',
		ariaLabel: pullRequestNumberLabel(
			'Waiting for GitHub to report on pull request',
			pullRequest.number,
		),
		tooltip,
		disabled: true,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function noChanges(): NextAction {
	return {
		kind: 'no-changes',
		label: 'No changes',
		busyLabel: 'No changes',
		ariaLabel: 'No changes to open a pull request for',
		tooltip:
			'There is nothing to open a pull request for yet. Change a file in this workstream to publish it',
		disabled: true,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function agentRunning(): NextAction {
	return {
		kind: 'agent-running',
		label: 'Agent working…',
		busyLabel: 'Agent working…',
		ariaLabel: 'Waiting for the agent to finish',
		tooltip:
			'The agent is still changing this workstream. Pull request actions return once it finishes',
		disabled: true,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function reconnect(): NextAction {
	return {
		kind: 'reconnect',
		label: 'Reconnect GitHub',
		busyLabel: 'Reconnecting GitHub…',
		ariaLabel: 'Reconnect your GitHub account',
		tooltip:
			'GitHub no longer accepts the stored sign-in. Sign in with GitHub again to restore this workstream',
		disabled: false,
		tone: 'primary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function retry(tooltip: string, number: number | null | undefined): NextAction {
	return {
		kind: 'retry',
		label: 'Retry status',
		busyLabel: 'Retrying…',
		ariaLabel: pullRequestNumberLabel('Retry repository and pull request status', number),
		tooltip,
		disabled: false,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function unavailable(
	label: string,
	busyLabel: string,
	ariaLabel: string,
	tooltip: string,
): NextAction {
	return {
		kind: 'unavailable',
		label,
		busyLabel,
		ariaLabel,
		tooltip,
		disabled: true,
		tone: 'secondary',
		confirmLabel: null,
		confirmBusyLabel: null,
	};
}

function pullRequestNumberLabel(label: string, number: number | null | undefined): string {
	return number === null || number === undefined ? label : `${label} #${number}`;
}

function mergeMethodInstruction(method: PullRequestMergeMethod): string {
	if (method === 'squash') return 'Squash and merge';
	if (method === 'rebase') return 'Rebase and merge';
	return 'Merge';
}

function commitCount(count: number): string {
	return `${count} ${count === 1 ? 'commit' : 'commits'}`;
}
