import type { ShipStep } from '$contract/pull-requests';
import type { WorktreeOperation } from '$contract/repositories';
import {
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

export type AgentWork = 'agent' | 'commands';

export function pullRequestTopBar(
	ship: PullRequestShip | null,
	surface: RepositorySurface | null,
	availability: PullRequestAvailability,
	agentWork: AgentWork | null = null,
): PullRequestTopBar {
	const read = surface !== null && repositorySurfaceHasBeenRead(surface) ? surface : null;
	const remoteFailure = surface === null ? null : surfaceFailure(surface);
	const url = read?.pullRequest?.url ?? ship?.pullRequestUrl ?? null;
	const status = workstreamStatus(ship, read, availability, surface, url, agentWork);
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
	agentWork: AgentWork | null,
): WorkstreamStatus | null {
	const settle = (settled: WorkstreamStatus | null): WorkstreamStatus | null =>
		agentWork ? whileAgentWorks(settled, agentWork) : settled;
	const mergedOnGithub = read?.pullRequest?.state === 'merged';
	if (ship?.phase === 'needs-you' && !mergedOnGithub) return needsYou(ship, read, url);
	if (ship?.phase === 'queued') return queued(ship);
	if (ship?.phase === 'draft' && ship.step && ship.pullRequestNumber === null) {
		return openingDraft(ship);
	}
	if (ship?.step && CLEARING_BLOCKERS_STEPS.has(ship.step)) {
		return clearingBlockers(availability === 'ready' ? shipStatus(ship, read) : null);
	}
	if (availability === 'extension-unavailable') return settle(EXTENSION_OFF);
	if (availability === 'github-unavailable') return read ? settle(withoutGithub(read)) : null;

	const blocker = connectionBlocker(read, surface);
	if (blocker) return blocker;
	const operation = read && blockingOperation(read);
	if (operation) return operation;
	return settle(shipStatus(ship, read));
}

const CLEARING_BLOCKERS_STEPS: ReadonlySet<ShipStep> = new Set([
	'updating-from-main',
	'resolving-conflicts',
	'fixing-checks',
	'addressing-review',
]);

function shipStatus(
	ship: PullRequestShip | null,
	read: RepositorySurface | null,
): WorkstreamStatus | null {
	if (!read) return ship?.pullRequestNumber ? openBeforeRead(ship.pullRequestNumber, ship) : null;
	const pullRequest = read.pullRequest;
	if (pullRequest?.state === 'merged') return merged(read, pullRequest);
	if (pullRequest && publishedPullRequest(pullRequest)) {
		return {
			...openStatus(pullRequest),
			tooltip: ship?.lastError ?? null,
			action: queueMerge(pullRequest.number),
		};
	}
	if (ship?.pullRequestNumber && pullRequest?.state !== 'closed') {
		return openBeforeRead(ship.pullRequestNumber, ship);
	}
	if (pullRequest?.state === 'closed') return closed(pullRequest, ship);
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
		[sentence(explanation), NEEDS_YOU_NEXT_STEP].filter(Boolean).join(' '),
		needsYouAction(ship, operation, url),
	);
}

const NEEDS_YOU_NEXT_STEP = 'The merge picks up again on its own once this is resolved.';

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
	return {
		tone: 'queued',
		busy: true,
		label: merging ? 'Merging' : ship.keep ? 'Queued to merge and keep' : 'Queued for merge',
		detail: ship.lastError
			? 'Retrying after an error'
			: ship.step === null
				? null
				: shipStepDetail(ship.step),
		tooltip: ship.lastError,
		action: merging ? null : CANCEL_MERGE,
		...(merging || ship.keep ? {} : { secondaryAction: KEEP }),
	};
}

function openingDraft(ship: PullRequestShip): WorkstreamStatus {
	return {
		tone: 'idle',
		busy: true,
		label: 'Opening draft',
		detail: ship.lastError
			? 'Retrying after an error'
			: ship.step === 'waiting-for-agent'
				? 'After the agent finishes'
				: null,
		tooltip: ship.lastError,
		action: null,
	};
}

function clearingBlockers(settled: WorkstreamStatus | null): WorkstreamStatus {
	return working('Clearing blockers', settled);
}

function whileAgentWorks(
	settled: WorkstreamStatus | null,
	work: AgentWork,
): WorkstreamStatus | null {
	if (settled?.tone !== 'idle' && settled?.tone !== 'ready') return settled;
	return working(work === 'agent' ? 'Agent running' : 'Commands running', settled);
}

function working(label: string, settled: WorkstreamStatus | null): WorkstreamStatus {
	const secondary = settled?.secondaryAction ? neutral(settled.secondaryAction) : null;
	return {
		tone: 'idle',
		busy: true,
		label,
		detail: null,
		tooltip: null,
		action: settled?.action ? neutral(settled.action) : null,
		...(secondary ? { secondaryAction: secondary } : {}),
	};
}

function neutral(action: PullRequestTopBarAction): PullRequestTopBarAction {
	return { ...action, tone: 'secondary' };
}

const NOTHING_YET: WorkstreamStatus = {
	tone: 'idle',
	busy: false,
	label: 'Build something great',
	detail: null,
	tooltip: null,
	action: null,
};

const EXTENSION_OFF: WorkstreamStatus = {
	tone: 'idle',
	busy: false,
	label: 'Repository extension is off',
	detail: null,
	tooltip: null,
	action: null,
};

function withoutGithub(read: RepositorySurface): WorkstreamStatus {
	const changed = changedFileCount(read);
	if (changed === 0) return NOTHING_YET;
	return { ...line('idle', filesChanged(changed), 'No GitHub remote'), action: null };
}

function connectionBlocker(
	read: RepositorySurface | null,
	surface: RepositorySurface | null,
): WorkstreamStatus | null {
	if (read?.pullRequest?.state === 'unavailable') {
		return attention('GitHub account not connected', null, CONNECT);
	}
	if (read?.github?.session === 'reconnect-required') {
		return attention('GitHub sign-in expired', null, RECONNECT);
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

function merged(read: RepositorySurface, pullRequest: SurfacePullRequest): WorkstreamStatus {
	return {
		...line('merged', 'Merged', null),
		action: ARCHIVE,
		...(read.baseBranch && pullRequest.headSha
			? { secondaryAction: continueOnBase(read.baseBranch) }
			: {}),
	};
}

function continueOnBase(baseBranch: string): PullRequestTopBarAction {
	return {
		kind: 'continue',
		label: 'Continue',
		ariaLabel: `Continue on top of the latest ${baseBranch}`,
		tone: 'secondary',
		confirmLabel: null,
	};
}

const ARCHIVE: PullRequestTopBarAction = {
	kind: 'archive',
	label: 'Archive',
	ariaLabel: 'Archive this workstream',
	tone: 'primary',
	confirmLabel: null,
};

function closed(pullRequest: SurfacePullRequest, ship: PullRequestShip | null): WorkstreamStatus {
	return {
		...line('idle', 'Closed', null),
		tooltip: ship?.lastError ?? null,
		action: {
			kind: 'reopen',
			label: 'Reopen',
			ariaLabel:
				pullRequest.number === null
					? 'Reopen the pull request'
					: `Reopen pull request #${pullRequest.number}`,
			tone: 'primary',
			confirmLabel: null,
		},
		secondaryAction: neutral(ARCHIVE),
	};
}

function local(read: RepositorySurface, ship: PullRequestShip | null): WorkstreamStatus {
	const changed = changedFileCount(read);
	if (changed === 0) return NOTHING_YET;
	return {
		...line('idle', filesChanged(changed), null),
		tooltip: ship?.lastError ?? null,
		action: MERGE,
		secondaryAction: OPEN_DRAFT,
	};
}

function openBeforeRead(pullRequestNumber: number, ship: PullRequestShip): WorkstreamStatus {
	return {
		...line('idle', 'Open', null),
		tooltip: ship.lastError,
		action: queueMerge(pullRequestNumber),
	};
}

function openStatus(pullRequest: SurfacePullRequest): StatusLine {
	if (pullRequest.githubLagsPush) return CHECKS_STARTING;

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
		return line('idle', `${threads} unresolved ${plural(threads, 'thread')}`, null);
	}

	const pending = checks.filter(
		(check) => !check.passed && !check.failed && !check.notStartedReason,
	).length;
	if (pending > 0) {
		return {
			...line('idle', 'Checks running', `${pending} of ${checks.length} pending`),
			busy: true,
		};
	}
	if (pullRequest.checks === 'pending') return CHECKS_STARTING;
	const notStartedReason = checks.find((check) => check.notStartedReason)?.notStartedReason;
	if (notStartedReason) return line('idle', "CI didn't start", sentenceCase(notStartedReason));
	const optional = checks.filter((check) => check.required === false && check.failed).length;
	if (pullRequest.checks === 'failed' && optional === 0) return line('idle', 'Checks failed', null);

	if (pullRequest.reviewDecision === 'review_required') {
		return line('idle', 'Review required', null);
	}
	if (optional > 0) {
		return line(
			'ready',
			'Ready to merge',
			`${optional} optional ${plural(optional, 'check')} failed`,
		);
	}
	if (checks.length > 0 || pullRequest.checks === 'success') {
		return line('ready', 'Ready to merge', null);
	}
	return line('idle', 'Open', 'No checks configured');
}

function line(tone: WorkstreamStatus['tone'], label: string, detail: string | null): StatusLine {
	return { tone, busy: false, label, detail, tooltip: null };
}

const CHECKS_STARTING: StatusLine = { ...line('idle', 'Checks starting', null), busy: true };

function attention(
	reason: string | null,
	tooltip: string | null,
	action: PullRequestTopBarAction | null,
): WorkstreamStatus {
	return {
		tone: 'needs-you',
		busy: false,
		label: reason ?? 'Needs you',
		detail: null,
		tooltip,
		action,
	};
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

function queueMerge(pullRequestNumber: number | null): PullRequestTopBarAction {
	return {
		...MERGE,
		ariaLabel: pullRequestNumber === null ? 'Merge' : `Merge pull request #${pullRequestNumber}`,
	};
}

const MERGE: PullRequestTopBarAction = {
	kind: 'queue-merge',
	label: 'Merge',
	ariaLabel: 'Merge',
	tone: 'primary',
	confirmLabel: null,
};

const OPEN_DRAFT: PullRequestTopBarAction = {
	kind: 'open-draft',
	label: 'Draft',
	ariaLabel: 'Open a draft pull request',
	tone: 'secondary',
	confirmLabel: null,
};

const CANCEL_MERGE: PullRequestTopBarAction = {
	kind: 'cancel-merge',
	label: 'Cancel',
	ariaLabel: 'Cancel the queued merge',
	tone: 'secondary',
	confirmLabel: 'Confirm cancel',
};

const KEEP: PullRequestTopBarAction = {
	kind: 'keep',
	label: 'Keep',
	ariaLabel: 'Keep this workstream after it merges',
	tone: 'secondary',
	confirmLabel: null,
};

const OPEN_PULL_REQUEST: PullRequestTopBarAction = {
	kind: 'open-pull-request',
	label: 'Open PR',
	ariaLabel: 'Open the pull request on GitHub',
	tone: 'primary',
	confirmLabel: null,
};

const OPEN_JOB: PullRequestTopBarAction = {
	kind: 'open-job',
	label: 'Open job',
	ariaLabel: 'Open the transcript of the job that stopped',
	tone: 'primary',
	confirmLabel: null,
};

const RECONNECT: PullRequestTopBarAction = {
	kind: 'reconnect',
	label: 'Reconnect',
	ariaLabel: 'Reconnect your GitHub account',
	tone: 'primary',
	confirmLabel: null,
};

const CONNECT: PullRequestTopBarAction = {
	kind: 'reconnect',
	label: 'Connect',
	ariaLabel: 'Connect the repository GitHub account',
	tone: 'primary',
	confirmLabel: null,
};

const RETRY: PullRequestTopBarAction = {
	kind: 'refresh',
	label: 'Retry',
	ariaLabel: 'Read the repository status again',
	tone: 'primary',
	confirmLabel: null,
};

function abortOperation(operation: WorktreeOperation): PullRequestTopBarAction {
	return {
		kind: 'abort-operation',
		label: `Abort ${operation}`,
		ariaLabel: `Abort the ${operation} in this workstream`,
		tone: 'primary',
		confirmLabel: 'Confirm abort',
	};
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
