import type { WorktreeOperation } from '$contract/repositories';
import {
	worktreeOperationNoun,
	type PullRequestAvailability,
	type PullRequestMenuItem,
	type PullRequestTopBar,
	type PullRequestTopBarAction,
} from './pull-request-action';
import {
	needsYouDestination,
	needsYouReasonDescription,
	needsYouReasonLabel,
	shipStepDescription,
	shipStepLabel,
	type PullRequestNeedsYouDestination,
	type PullRequestShip,
} from './pull-request-ship';
import {
	repositorySurfaceHasBeenRead,
	type RepositorySurface,
	type SurfacePullRequest,
	type SurfacePullRequestCheck,
} from './repository-surface';

export function pullRequestTopBar(
	ship: PullRequestShip | null,
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
): PullRequestTopBar {
	const read = surface !== null && repositorySurfaceHasBeenRead(surface) ? surface : null;
	const remoteFailure = surface === null ? null : surfaceFailure(surface);
	const url = read?.pullRequest?.url ?? ship?.pullRequestUrl ?? null;
	return {
		action: topBarAction(ship, read, availability, url),
		menu: topBarMenu(ship, surface, remoteFailure),
		remoteFailure,
		pullRequestNumber: read?.pullRequest?.number ?? ship?.pullRequestNumber ?? null,
		url,
	};
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

function topBarAction(
	ship: PullRequestShip | null,
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
	url: string | null,
): PullRequestTopBarAction | null {
	if (ship?.phase === 'queued') return queued(ship);
	if (ship?.phase === 'needs-you') return needsYou(ship, surface, url);
	if (ship?.step && ship.pullRequestNumber === null) return openingDraft(ship);

	const blocker = setupBlocker(surface, availability);
	if (blocker) return blocker;
	if (!surface) return ship?.pullRequestNumber ? queueMerge(ship.pullRequestNumber, ship) : null;

	const operation = blockingOperation(surface);
	if (operation) return operation;

	const pullRequest = surface.pullRequest;
	if (pullRequest?.state === 'merged') return null;
	if (publishedPullRequest(pullRequest)) return queueMerge(pullRequest?.number ?? null, ship);
	if (ship?.pullRequestNumber && pullRequest?.state !== 'closed') {
		return queueMerge(ship.pullRequestNumber, ship);
	}
	if (surface.changedFiles === 0 && surface.dirtyPaths.length === 0) return null;
	return openDraft(ship, pullRequest);
}

function topBarMenu(
	ship: PullRequestShip | null,
	surface: RepositorySurface | null,
	remoteFailure: string | null,
): readonly PullRequestMenuItem[] {
	const merging = ship?.phase === 'queued' || ship?.phase === 'needs-you';
	const operation = surface?.operationInProgress ?? null;
	const numbered = Boolean(surface?.pullRequest?.number ?? ship?.pullRequestNumber);
	return [
		...(ship?.phase === 'needs-you' ? [RETRY_MERGE] : []),
		...(merging ? [CANCEL_MERGE] : []),
		...(operation ? [abortOperation(operation)] : []),
		...(surface && (numbered || remoteFailure) ? [REFRESH] : []),
	];
}

const RETRY_MERGE: PullRequestMenuItem = { id: 'retry-merge', label: 'Retry', confirmLabel: null };

const CANCEL_MERGE: PullRequestMenuItem = {
	id: 'cancel-merge',
	label: 'Cancel merge',
	confirmLabel: 'Confirm cancel',
};

const REFRESH: PullRequestMenuItem = { id: 'refresh', label: 'Refresh', confirmLabel: null };

function abortOperation(operation: WorktreeOperation): PullRequestMenuItem {
	return { id: 'abort-operation', label: `Abort ${operation}`, confirmLabel: 'Confirm abort' };
}

function surfaceFailure(surface: RepositorySurface): string | null {
	if (surface.localError) return surface.localError;
	if (surface.pullRequestError) return surface.pullRequestError;
	if (surface.pullRequestRefreshStatus === 'error') return 'Pull request status is unavailable';
	return null;
}

function queued(ship: PullRequestShip): PullRequestTopBarAction {
	const step = ship.step === null ? null : shipStepLabel(ship.step);
	const description =
		ship.step === null ? 'Malini is shipping this pull request' : shipStepDescription(ship.step);
	return {
		kind: 'queued',
		label: step ? `Queued · ${step}` : 'Queued',
		ariaLabel: step ? `Merge queued · ${step}` : 'Merge queued',
		tooltip: ship.lastError
			? `${description}. The last attempt failed and malini retries it: ${ship.lastError}`
			: `${description}. Cancel the merge from the pull request menu`,
		disabled: false,
		busy: true,
		tone: 'secondary',
	};
}

const NEEDS_YOU_HINTS: Readonly<Record<PullRequestNeedsYouDestination, string>> = {
	'pull-request': 'Opens the pull request on GitHub.',
	job: "Opens the job's transcript.",
	repositories: 'Opens the repositories page to sign in with GitHub again.',
};

const NEEDS_YOU_NEXT_STEP = 'Retry or cancel the merge from the pull request menu.';

function needsYou(
	ship: PullRequestShip,
	surface: RepositorySurface | null,
	url: string | null,
): PullRequestTopBarAction {
	const reason = ship.needsYou?.reason ?? null;
	const label = reason
		? needsYouReasonLabel(reason, surface?.operationInProgress ?? null)
		: 'Needs you';
	const destination = reachableDestination(
		ship.needsYou ? needsYouDestination(ship.needsYou) : null,
		url,
	);
	const detail = ship.needsYou?.detail.trim() || (reason ? needsYouReasonDescription(reason) : '');
	return {
		kind: 'needs-you',
		label,
		ariaLabel: `Needs you · ${label}`,
		tooltip: [sentence(detail), destination && NEEDS_YOU_HINTS[destination], NEEDS_YOU_NEXT_STEP]
			.filter(Boolean)
			.join(' '),
		disabled: destination === null,
		busy: false,
		tone: 'primary',
	};
}

function reachableDestination(
	destination: PullRequestNeedsYouDestination | null,
	url: string | null,
): PullRequestNeedsYouDestination | null {
	return destination === 'pull-request' && url === null ? null : destination;
}

function openingDraft(ship: PullRequestShip): PullRequestTopBarAction {
	const waiting = ship.step === 'waiting-for-agent';
	const label = waiting ? 'Waiting for the agent…' : 'Opening draft…';
	return {
		kind: 'opening-draft',
		label,
		ariaLabel: label,
		tooltip: ship.lastError
			? `Opening the draft failed and malini retries it: ${ship.lastError}`
			: waiting
				? 'Malini opens the draft pull request once the agent finishes its run'
				: 'Malini is committing, pushing and opening a draft pull request',
		disabled: false,
		busy: true,
		tone: 'primary',
	};
}

function setupBlocker(
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
): PullRequestTopBarAction | null {
	if (availability === 'github-unavailable') {
		return unavailable(
			'Connect GitHub',
			'Connect GitHub to publish this workstream',
			'Connect this workstream to a GitHub repository to open a pull request',
		);
	}
	if (availability === 'extension-unavailable') {
		return unavailable(
			'Enable Repository',
			'Enable the Repository extension for pull request actions',
			'Enable the Repository extension to open or merge a pull request',
		);
	}
	if (surface?.pullRequest?.state === 'unavailable') {
		return unavailable(
			'Connect GitHub',
			'Connect the repository GitHub account',
			'Connect the repository GitHub account to open or merge a pull request',
		);
	}
	if (surface?.github?.session === 'reconnect-required') return reconnect();
	return null;
}

function blockingOperation(surface: RepositorySurface): PullRequestTopBarAction | null {
	const operation = surface.operationInProgress;
	if (operation === null) return null;
	const marked = surface.conflictMarkerPaths.length;
	if (operation === 'merge' && marked === 0) return null;
	const noun = worktreeOperationNoun(operation);
	return {
		kind: 'operation',
		label: `${noun} in progress`,
		ariaLabel: `${noun} in progress in this workstream`,
		tooltip:
			operation === 'merge'
				? `${marked} file${marked === 1 ? ' still has' : 's still have'} conflict markers. Resolve them, or abort the merge from the pull request menu`
				: `A ${operation} stopped part-way in this workstream. Finish it in a terminal, or abort it from the pull request menu`,
		disabled: true,
		busy: false,
		tone: 'secondary',
	};
}

function queueMerge(
	pullRequestNumber: number | null,
	ship: PullRequestShip | null,
): PullRequestTopBarAction {
	return {
		kind: 'queue-merge',
		label: 'Queue merge',
		ariaLabel:
			pullRequestNumber === null
				? 'Queue merge'
				: `Queue merge for pull request #${pullRequestNumber}`,
		tooltip: ship?.lastError
			? `Pushing the latest work failed and malini retries it: ${ship.lastError}`
			: 'Malini marks the pull request ready, keeps it up to date and its checks green, and merges it once GitHub allows',
		disabled: false,
		busy: false,
		tone: 'primary',
	};
}

function openDraft(
	ship: PullRequestShip | null,
	pullRequest: SurfacePullRequest | null,
): PullRequestTopBarAction {
	const replacing = pullRequest?.state === 'closed';
	return {
		kind: 'open-draft',
		label: 'Open draft',
		ariaLabel: replacing ? 'Open a replacement draft pull request' : 'Open a draft pull request',
		tooltip: ship?.lastError
			? `Opening the draft failed: ${ship.lastError}. Try again`
			: replacing
				? 'The previous pull request is closed. Commit, push and open a new draft pull request'
				: 'Commit and push this workstream, then open a draft pull request',
		disabled: false,
		busy: false,
		tone: 'primary',
	};
}

function reconnect(): PullRequestTopBarAction {
	return {
		kind: 'reconnect',
		label: 'Reconnect GitHub',
		ariaLabel: 'Reconnect your GitHub account',
		tooltip:
			'GitHub no longer accepts the stored sign-in. Sign in with GitHub again to restore this workstream',
		disabled: false,
		busy: false,
		tone: 'primary',
	};
}

function unavailable(label: string, ariaLabel: string, tooltip: string): PullRequestTopBarAction {
	return {
		kind: 'unavailable',
		label,
		ariaLabel,
		tooltip,
		disabled: true,
		busy: false,
		tone: 'secondary',
	};
}

function publishedPullRequest(pullRequest: SurfacePullRequest | null): boolean {
	return pullRequest?.state === 'open' || pullRequest?.state === 'draft';
}

function sentence(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return '';
	return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
