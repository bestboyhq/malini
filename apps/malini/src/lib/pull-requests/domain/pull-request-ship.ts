import type {
	ShipNeedsYou,
	ShipNeedsYouReason,
	ShipPhase,
	ShipStep,
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
	lastError: string | null;
	updatedAt: string;
}>;

export type PullRequestShipChange = Readonly<{
	workstreamId: string;
	ship: PullRequestShip | null;
	mergedPullRequestNumber: number | null;
}>;

export type PullRequestShipIntent =
	'open-draft' | 'queue-merge' | 'cancel-merge' | 'retry-merge' | 'keep-workstream';

export type PullRequestNeedsYouDestination = 'pull-request' | 'job' | 'repositories';

const STEP_DETAILS: Readonly<Partial<Record<ShipStep, string>>> = {
	'waiting-for-agent': 'Waiting for the agent',
	'opening-draft': 'Opening the pull request',
	'updating-from-main': 'Clearing blockers',
	'resolving-conflicts': 'Clearing blockers',
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

export function shipStepDetail(step: ShipStep): string | null {
	return STEP_DETAILS[step] ?? null;
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
