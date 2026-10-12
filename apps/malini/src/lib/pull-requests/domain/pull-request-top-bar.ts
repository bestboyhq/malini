import type { WorktreeOperation } from '$contract/repositories';
import {
	worktreeOperationNoun,
	type PullRequestAvailability,
	type PullRequestMenuItem,
	type PullRequestTopBar,
	type PullRequestTopBarAction,
	type WorkstreamStatus,
} from './pull-request-action';
import {
	needsYouDestination,
	needsYouReasonDescription,
	needsYouReasonLabel,
	shipStepDescription,
	shipStepDetail,
	type PullRequestShip,
} from './pull-request-ship';
import {
	repositorySurfaceHasBeenRead,
	type RepositorySurface,
	type SurfacePullRequest,
	type SurfacePullRequestCheck,
} from './repository-surface';

type StatusLine = Omit<WorkstreamStatus, 'action'>;

export function pullRequestTopBar(
	ship: PullRequestShip | null,
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
): PullRequestTopBar {
	const read = surface !== null && repositorySurfaceHasBeenRead(surface) ? surface : null;
	const remoteFailure = surface === null ? null : surfaceFailure(surface);
	const url = read?.pullRequest?.url ?? ship?.pullRequestUrl ?? null;
	const status = workstreamStatus(ship, read, availability, surface, url);
	return {
		status,
		menu: topBarMenu(ship, surface, remoteFailure).filter(
			(item) => item.id !== status?.action?.kind,
		),
		remoteFailure,
		pullRequestNumber: read?.pullRequest?.number ?? ship?.pullRequestNumber ?? null,
		url,
	};
}

function workstreamStatus(
	ship: PullRequestShip | null,
	read: RepositorySurface | null,
	availability: PullRequestAvailability,
	surface: RepositorySurface | null,
	url: string | null,
): WorkstreamStatus | null {
	if (ship?.phase === 'needs-you') return needsYou(ship, read, url);
	if (ship?.phase === 'queued') return queued(ship);
	if (ship?.step && ship.pullRequestNumber === null) return openingDraft(ship);
	if (availability === 'extension-unavailable') return EXTENSION_OFF;
	if (availability === 'github-unavailable') return read ? withoutGithub(read) : null;

	const blocker = connectionBlocker(read, surface);
	if (blocker) return blocker;
	if (!read) return ship?.pullRequestNumber ? openBeforeRead(ship.pullRequestNumber, ship) : null;

	const operation = blockingOperation(read);
	if (operation) return operation;

	const pullRequest = read.pullRequest;
	if (pullRequest?.state === 'merged') return merged(read);
	if (pullRequest && publishedPullRequest(pullRequest)) {
		return { ...openStatus(read, pullRequest), action: queueMerge(pullRequest.number, ship) };
	}
	if (ship?.pullRequestNumber && pullRequest?.state !== 'closed') {
		return openBeforeRead(ship.pullRequestNumber, ship);
	}
	if (pullRequest?.state === 'closed') return closed(read, ship);
	return local(read, ship);
}

function needsYou(
	ship: PullRequestShip,
	read: RepositorySurface | null,
	url: string | null,
): WorkstreamStatus {
	const reason = ship.needsYou?.reason ?? null;
	const operation = read?.operationInProgress ?? null;
	const explanation =
		ship.needsYou?.detail.trim() || (reason ? needsYouReasonDescription(reason) : '');
	return attention(
		reason ? needsYouReasonLabel(reason, operation) : null,
		sentence(explanation) || null,
		needsYouAction(ship, operation, url),
	);
}

function needsYouAction(
	ship: PullRequestShip,
	operation: WorktreeOperation | null,
	url: string | null,
): PullRequestTopBarAction | null {
	const destination = ship.needsYou ? needsYouDestination(ship.needsYou) : null;
	if (destination === 'repositories') return RECONNECT;
	if (destination === 'job') return OPEN_JOB;
	if (destination === 'pull-request') return url ? OPEN_PULL_REQUEST : null;
	return operation ? abortOperation(operation) : null;
}

function queued(ship: PullRequestShip): WorkstreamStatus {
	const merging = ship.step === 'merging' || ship.step === 'archiving';
	const description =
		ship.step === null ? 'Malini is shipping this pull request' : shipStepDescription(ship.step);
	return {
		tone: 'queued',
		busy: true,
		label: merging ? 'Merging' : 'Queued for merge',
		detail: ship.lastError
			? 'Retrying after an error'
			: ship.step === null
				? null
				: shipStepDetail(ship.step),
		tooltip: ship.lastError
			? `${description}. The last attempt failed and malini retries it: ${ship.lastError}`
			: `${description}.`,
		action: merging ? null : CANCEL_MERGE,
	};
}

function openingDraft(ship: PullRequestShip): WorkstreamStatus {
	const waiting = ship.step === 'waiting-for-agent';
	return {
		tone: 'idle',
		busy: true,
		label: 'Opening draft',
		detail: ship.lastError
			? 'Retrying after an error'
			: waiting
				? 'After the agent finishes'
				: 'Committing and pushing',
		tooltip: ship.lastError
			? `Opening the draft failed and malini retries it: ${ship.lastError}`
			: waiting
				? 'Malini opens the draft pull request once the agent finishes its run'
				: 'Malini is committing, pushing and opening a draft pull request',
		action: null,
	};
}

const NOTHING_YET: WorkstreamStatus = {
	tone: 'idle',
	busy: false,
	label: 'Build something great',
	detail: 'Ask the agent for a change',
	tooltip: null,
	action: null,
};

const EXTENSION_OFF: WorkstreamStatus = {
	tone: 'idle',
	busy: false,
	label: 'Repository extension is off',
	detail: 'Add it back from the inspector',
	tooltip: 'Turn the Repository extension back on to open or merge a pull request',
	action: null,
};

function withoutGithub(read: RepositorySurface): WorkstreamStatus {
	const changed = changedFileCount(read);
	if (changed === 0) return NOTHING_YET;
	return {
		...line('idle', filesChanged(changed), 'No GitHub remote to publish to'),
		tooltip: 'Connect this workstream to a GitHub repository to open a pull request',
		action: null,
	};
}

function connectionBlocker(
	read: RepositorySurface | null,
	surface: RepositorySurface | null,
): WorkstreamStatus | null {
	if (read?.pullRequest?.state === 'unavailable') {
		return attention(
			'GitHub account not connected',
			'Connect the repository GitHub account to open or merge a pull request.',
			CONNECT,
		);
	}
	if (read?.github?.session === 'reconnect-required') {
		return attention(
			'GitHub sign-in expired',
			'GitHub no longer accepts the stored sign-in. Sign in with GitHub again to restore this workstream.',
			RECONNECT,
		);
	}
	const failure = surface === null ? null : surfaceFailure(surface);
	if (!failure) return null;
	return attention(
		surface?.localError ? "Couldn't read the worktree" : 'GitHub is unreachable',
		failure,
		RETRY,
	);
}

function blockingOperation(read: RepositorySurface): WorkstreamStatus | null {
	const operation = read.operationInProgress;
	if (operation === null) return null;
	const marked = read.conflictMarkerPaths.length;
	if (operation === 'merge' && marked === 0) return null;
	return attention(
		operation === 'merge'
			? 'Merge has conflicts'
			: needsYouReasonLabel('operation-in-progress', operation),
		operation === 'merge'
			? `${marked} file${marked === 1 ? ' still has' : 's still have'} conflict markers. Resolve them, or abort the merge.`
			: `A ${operation} stopped part-way in this workstream. Finish it in a terminal, or abort it.`,
		abortOperation(operation),
	);
}

function merged(read: RepositorySurface): WorkstreamStatus {
	return {
		...line('merged', 'Merged', read.baseBranch ? `Into ${read.baseBranch}` : null),
		action: null,
	};
}

function closed(read: RepositorySurface, ship: PullRequestShip | null): WorkstreamStatus {
	return {
		...line('idle', 'Closed', 'Not merged'),
		action: changedFileCount(read) > 0 ? openDraft(ship, true) : null,
	};
}

function local(read: RepositorySurface, ship: PullRequestShip | null): WorkstreamStatus {
	const changed = changedFileCount(read);
	if (changed === 0) return NOTHING_YET;
	return {
		...line('idle', filesChanged(changed), 'Not on GitHub yet'),
		action: openDraft(ship, false),
	};
}

function openBeforeRead(pullRequestNumber: number, ship: PullRequestShip): WorkstreamStatus {
	return { ...line('idle', 'Open', null), action: queueMerge(pullRequestNumber, ship) };
}

function openStatus(read: RepositorySurface, pullRequest: SurfacePullRequest): StatusLine {
	const base = read.baseBranch ?? 'its base';
	if (pullRequestConflictsWithBase(pullRequest) || read.conflictMarkerPaths.length > 0) {
		return line('idle', 'Merge conflicts', `With ${base}`);
	}
	if (pullRequest.githubLagsPush) return running('Starting on GitHub');

	const checks = pullRequest.checkItems;
	const failing = surfaceBlockingChecks(checks).filter(
		(check) => check.failed && !check.notStartedReason,
	);
	if (failing.length > 0) return line('idle', 'Checks failed', checkNames(failing));
	if (pullRequest.reviewDecision === 'changes_requested') {
		return line('idle', 'Changes requested', null);
	}
	const threads = pullRequest.unresolvedReviewThreadCount ?? 0;
	if (threads > 0) {
		return line('idle', `${threads} unresolved ${plural(threads, 'thread')}`, 'Comments on GitHub');
	}

	const pending = checks.filter(
		(check) => !check.passed && !check.failed && !check.notStartedReason,
	).length;
	if (pending > 0) return running(`${pending} of ${checks.length} pending`);
	if (pullRequest.checks === 'pending') return running('Starting on GitHub');
	const notStartedReason = checks.find((check) => check.notStartedReason)?.notStartedReason;
	if (notStartedReason) {
		return {
			...line('idle', "CI didn't start", sentenceCase(notStartedReason)),
			tooltip: `GitHub didn't start CI: ${notStartedReason}`,
		};
	}
	const optional = checks.filter((check) => check.required === false && check.failed).length;
	if (pullRequest.checks === 'failed' && optional === 0) return line('idle', 'Checks failed', null);

	const mergeState = pullRequest.mergeableState?.trim().toLocaleLowerCase();
	if (read.behind > 0 || mergeState === 'behind') {
		return line(
			'idle',
			`Behind ${base}`,
			read.behind > 0 ? `${read.behind} ${plural(read.behind, 'commit')}` : null,
		);
	}
	if (pullRequest.reviewDecision === 'review_required') {
		return line('idle', 'Review required', 'Needs an approval');
	}
	if (optional > 0) {
		return line(
			'ready',
			'Ready to merge',
			`${optional} optional ${plural(optional, 'check')} failed`,
		);
	}
	if (checks.length > 1)
		return line('ready', 'Ready to merge', `All ${checks.length} checks passed`);
	if (checks.length === 1 || pullRequest.checks === 'success') {
		return line('ready', 'Ready to merge', 'Checks passed');
	}
	return line('idle', 'Open', 'No checks configured');
}

function line(tone: WorkstreamStatus['tone'], label: string, detail: string | null): StatusLine {
	return { tone, busy: false, label, detail, tooltip: null };
}

function running(detail: string): StatusLine {
	return { tone: 'idle', busy: true, label: 'Checks running', detail, tooltip: null };
}

function attention(
	detail: string | null,
	tooltip: string | null,
	action: PullRequestTopBarAction | null,
): WorkstreamStatus {
	return { tone: 'needs-you', busy: false, label: 'Needs you', detail, tooltip, action };
}

function changedFileCount(read: RepositorySurface): number {
	return Math.max(read.changedFiles, read.dirtyPaths.length);
}

function filesChanged(count: number): string {
	return `${count} ${plural(count, 'file')} changed`;
}

function checkNames(checks: readonly SurfacePullRequestCheck[]): string {
	const [first, second, ...rest] = checks.map((check) => check.name);
	const named = [first, second].filter(Boolean).join(', ');
	return rest.length > 0 ? `${named} +${rest.length}` : named;
}

function plural(count: number, noun: string): string {
	return count === 1 ? noun : `${noun}s`;
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
		...(merging ? [CANCEL_MERGE_ITEM] : []),
		...(operation ? [abortOperationItem(operation)] : []),
		...(surface && (numbered || remoteFailure) ? [REFRESH] : []),
	];
}

const RETRY_MERGE: PullRequestMenuItem = { id: 'retry-merge', label: 'Retry', confirmLabel: null };

const CANCEL_MERGE_ITEM: PullRequestMenuItem = {
	id: 'cancel-merge',
	label: 'Cancel merge',
	confirmLabel: 'Confirm cancel',
};

const REFRESH: PullRequestMenuItem = { id: 'refresh', label: 'Refresh', confirmLabel: null };

function abortOperationItem(operation: WorktreeOperation): PullRequestMenuItem {
	return { id: 'abort-operation', label: `Abort ${operation}`, confirmLabel: 'Confirm abort' };
}

function surfaceFailure(surface: RepositorySurface): string | null {
	if (surface.localError) return surface.localError;
	if (surface.pullRequestError) return surface.pullRequestError;
	if (surface.pullRequestRefreshStatus === 'error') return 'Pull request status is unavailable';
	return null;
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
		tone: 'primary',
		confirmLabel: null,
	};
}

function openDraft(ship: PullRequestShip | null, replacing: boolean): PullRequestTopBarAction {
	return {
		kind: 'open-draft',
		label: 'Open draft',
		ariaLabel: replacing ? 'Open a replacement draft pull request' : 'Open a draft pull request',
		tooltip: ship?.lastError
			? `Opening the draft failed: ${ship.lastError}. Try again`
			: replacing
				? 'The previous pull request is closed. Commit, push and open a new draft pull request'
				: 'Commit and push this workstream, then open a draft pull request',
		tone: 'primary',
		confirmLabel: null,
	};
}

const CANCEL_MERGE: PullRequestTopBarAction = {
	kind: 'cancel-merge',
	label: 'Cancel',
	ariaLabel: 'Cancel the queued merge',
	tooltip: 'Stops the merge queue. The pull request stays open',
	tone: 'secondary',
	confirmLabel: 'Confirm cancel',
};

const OPEN_PULL_REQUEST: PullRequestTopBarAction = {
	kind: 'open-pull-request',
	label: 'Open PR',
	ariaLabel: 'Open the pull request on GitHub',
	tooltip: 'Opens the pull request on GitHub',
	tone: 'primary',
	confirmLabel: null,
};

const OPEN_JOB: PullRequestTopBarAction = {
	kind: 'open-job',
	label: 'Open job',
	ariaLabel: 'Open the transcript of the job that stopped',
	tooltip: 'Opens the transcript of the job that stopped',
	tone: 'primary',
	confirmLabel: null,
};

const RECONNECT: PullRequestTopBarAction = {
	kind: 'reconnect',
	label: 'Reconnect',
	ariaLabel: 'Reconnect your GitHub account',
	tooltip: 'Opens the repositories page to sign in with GitHub again',
	tone: 'primary',
	confirmLabel: null,
};

const CONNECT: PullRequestTopBarAction = {
	kind: 'reconnect',
	label: 'Connect',
	ariaLabel: 'Connect the repository GitHub account',
	tooltip: 'Opens the repositories page to connect GitHub',
	tone: 'primary',
	confirmLabel: null,
};

const RETRY: PullRequestTopBarAction = {
	kind: 'refresh',
	label: 'Retry',
	ariaLabel: 'Read the repository status again',
	tooltip: 'Reads the worktree and the pull request again',
	tone: 'primary',
	confirmLabel: null,
};

function abortOperation(operation: WorktreeOperation): PullRequestTopBarAction {
	return {
		kind: 'abort-operation',
		label: `Abort ${operation}`,
		ariaLabel: `Abort the ${operation} in this workstream`,
		tooltip: `Returns the worktree to its last commit and drops the stopped ${worktreeOperationNoun(operation).toLocaleLowerCase()}`,
		tone: 'primary',
		confirmLabel: 'Confirm abort',
	};
}

function pullRequestConflictsWithBase(pullRequest: SurfacePullRequest): boolean {
	return (
		publishedPullRequest(pullRequest) &&
		pullRequest.mergeableState?.trim().toLocaleLowerCase() === 'dirty'
	);
}

function surfaceBlockingChecks(
	checkItems: readonly SurfacePullRequestCheck[],
): readonly SurfacePullRequestCheck[] {
	return checkItems.filter((check) => check.required !== false && !check.passed);
}

function publishedPullRequest(pullRequest: SurfacePullRequest): boolean {
	return pullRequest.state === 'open' || pullRequest.state === 'draft';
}

function sentenceCase(text: string): string {
	return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function sentence(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return '';
	return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
