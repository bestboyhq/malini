import type {
	ShipNeedsYou,
	ShipNeedsYouReason,
	ShipPhase,
	ShipStep,
	ShipWaitsFor,
} from '$contract/pull-requests';
import type { WorktreeOperation } from '$contract/repositories';
import { worktreeOperationNoun } from './pull-request-action';

export type PullRequestShip = Readonly<{
	workstreamId: string;
	phase: ShipPhase;
	step: ShipStep | null;
	keep: boolean;
	pullRequestNumber: number | null;
	pullRequestUrl: string | null;
	needsYou: ShipNeedsYou | null;
	checks: readonly string[];
	lastError: string | null;
	githubSaid: string | null;
	failures: number;
	failedSince: string | null;
	nextAttemptAt: string | null;
	waitsFor: ShipWaitsFor | null;
	updatedAt: string;
}>;

export type PullRequestShipChange = Readonly<{
	workstreamId: string;
	ship: PullRequestShip | null;
	mergedPullRequestNumber: number | null;
}>;

export type PullRequestShipIntent =
	| 'open-draft'
	| 'queue-merge'
	| 'cancel-merge'
	| 'cancel-draft'
	| 'retry-merge'
	| 'retry-now'
	| 'keep-workstream';

export type PullRequestNeedsYouDestination = 'pull-request' | 'job' | 'repositories';

const STEP_DETAILS: Readonly<Partial<Record<ShipStep, string>>> = {
	'waiting-for-agent': 'Waiting for the agent',
	'opening-draft': 'Opening the pull request',
	'updating-from-main': 'Clearing blockers',
	'resolving-conflicts': 'Clearing blockers',
	'rerunning-checks': 'Re-running failed checks',
	'fixing-checks': 'Clearing blockers',
	'addressing-review': 'Clearing blockers',
	'waiting-for-checks': 'Waiting for checks',
	'waiting-for-review': 'Waiting for review',
};

const REASON_LABELS: Readonly<
	Record<Exclude<ShipNeedsYouReason, 'operation-in-progress'>, string>
> = {
	'reply-to-reviewer': 'Reviewer needs a reply',
	'fix-gave-up': 'Fix gave up',
	'merge-not-permitted': 'GitHub blocks the merge',
	'pull-request-closed': 'Pull request was closed',
	'github-reconnect': 'GitHub sign-in expired',
};

const REASON_DESCRIPTIONS: Readonly<Record<ShipNeedsYouReason, string>> = {
	'reply-to-reviewer': 'A reviewer left comments only you can answer',
	'fix-gave-up': 'The agent could not fix the same failure after several attempts',
	'merge-not-permitted': 'GitHub does not let Malini merge this pull request',
	'pull-request-closed': 'The pull request was closed on GitHub',
	'github-reconnect': 'GitHub no longer accepts the stored sign-in',
	'operation-in-progress': 'A git operation stopped part-way in this workstream',
};

export function shipStepDetail(step: ShipStep, checks: readonly string[]): string | null {
	const named = checkNames(checks);
	if (named !== null && step === 'rerunning-checks') return `Re-running ${named}`;
	if (named !== null && step === 'fixing-checks') return `Fixing ${named}`;
	return STEP_DETAILS[step] ?? null;
}

function checkNames(checks: readonly string[]): string | null {
	const [first, second, ...rest] = checks;
	if (first === undefined) return null;
	if (second === undefined) return first;
	return rest.length === 0
		? `${first} and ${second}`
		: `${first} and ${checks.length - 1} more checks`;
}

export function needsYouReasonLabel(
	reason: ShipNeedsYouReason,
	operation: WorktreeOperation | null,
): string {
	if (reason === 'operation-in-progress') {
		return operation
			? `${worktreeOperationNoun(operation)} stopped part-way`
			: 'Git stopped part-way';
	}
	return REASON_LABELS[reason];
}

export function needsYouReasonDescription(reason: ShipNeedsYouReason): string {
	return REASON_DESCRIPTIONS[reason];
}

export type MergeStoppedOnJob = Readonly<{ jobRunId: string; detail: string }>;

export function mergeStoppedOnJob(ship: PullRequestShip | null): MergeStoppedOnJob | null {
	const stop = ship?.phase === 'needs-you' ? ship.needsYou : null;
	if (stop?.reason !== 'fix-gave-up' || !stop.jobRunId) return null;
	return {
		jobRunId: stop.jobRunId,
		detail: stop.detail.trim() || REASON_DESCRIPTIONS['fix-gave-up'],
	};
}

export function needsYouDestination(needsYou: ShipNeedsYou): PullRequestNeedsYouDestination | null {
	if (needsYou.reason === 'github-reconnect') return 'repositories';
	if (needsYou.reason === 'operation-in-progress') return needsYou.jobRunId ? 'job' : null;
	if (needsYou.reason === 'fix-gave-up' && needsYou.jobRunId) return 'job';
	return 'pull-request';
}

export function pullRequestNeedsYouAnnouncement(
	previous: PullRequestShip | null,
	change: PullRequestShipChange,
	workstreamName: string,
): string | null {
	if (change.ship?.phase !== 'needs-you' || previous?.phase === 'needs-you') return null;
	const reason = change.ship.needsYou?.reason;
	return reason
		? `${workstreamName} needs you · ${needsYouReasonLabel(reason, null)}`
		: `${workstreamName} needs you`;
}
