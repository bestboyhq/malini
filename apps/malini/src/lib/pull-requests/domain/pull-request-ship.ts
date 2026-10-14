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

export type PullRequestShipIntent = 'open-draft' | 'queue-merge' | 'cancel-merge' | 'retry-merge';

export type PullRequestNeedsYouDestination = 'pull-request' | 'job' | 'repositories';

export type PullRequestShipAnnouncement = Readonly<{
	level: 'success' | 'warning';
	message: string;
}>;

const STEP_DETAILS: Readonly<Partial<Record<ShipStep, string>>> = {
	'waiting-for-agent': 'Waiting for the agent',
	'opening-draft': 'Opening the pull request',
	'updating-from-main': 'Updating from main',
	'fixing-checks': 'Fixing checks',
	'addressing-review': 'Addressing review',
	'waiting-for-checks': 'Waiting for checks',
	'waiting-for-review': 'Waiting for review',
};

const STEP_DESCRIPTIONS: Readonly<Record<ShipStep, string>> = {
	'waiting-for-agent': 'Malini waits for the agent to finish, then ships its work',
	'opening-draft': 'Malini is opening the pull request',
	pushing: 'Malini is pushing the latest work',
	'marking-ready': 'Malini is marking the pull request ready for review',
	'updating-branch': 'Malini is bringing the branch up to date with its base',
	'updating-from-main': 'Malini is updating the branch from main and resolving any conflicts',
	'fixing-checks': 'An agent is fixing the failing checks',
	'addressing-review': 'An agent is addressing the bot review comments',
	'waiting-for-checks': 'Malini waits for the checks to finish on GitHub',
	'waiting-for-review': 'Malini waits for a required approval on GitHub',
	'waiting-for-github': 'Malini waits for GitHub to report whether the branch merges',
	merging: 'Malini is merging the pull request',
	archiving: 'The pull request merged. Malini is archiving the workstream',
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
	'reply-to-reviewer': 'A reviewer requested changes, and only you can answer them',
	'fix-gave-up': 'The agent could not fix the same failure after several attempts',
	'merge-not-permitted': 'GitHub does not let malini merge this pull request',
	'pull-request-closed': 'The pull request was closed on GitHub',
	'github-reconnect': 'GitHub no longer accepts the stored sign-in',
	'operation-in-progress': 'A git operation stopped part-way in this workstream',
};

export function shipStepDetail(step: ShipStep): string | null {
	return STEP_DETAILS[step] ?? null;
}

export function shipStepDescription(step: ShipStep): string {
	return STEP_DESCRIPTIONS[step];
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

export function needsYouDestination(needsYou: ShipNeedsYou): PullRequestNeedsYouDestination | null {
	if (needsYou.reason === 'github-reconnect') return 'repositories';
	if (needsYou.reason === 'operation-in-progress') return needsYou.jobRunId ? 'job' : null;
	if (needsYou.reason === 'fix-gave-up' && needsYou.jobRunId) return 'job';
	return 'pull-request';
}

export function pullRequestShipAnnouncement(
	previous: PullRequestShip | null,
	change: PullRequestShipChange,
	workstreamName: string,
): PullRequestShipAnnouncement | null {
	if (change.mergedPullRequestNumber !== null) {
		return {
			level: 'success',
			message: `Merged #${change.mergedPullRequestNumber} · ${workstreamName} archived`,
		};
	}
	if (change.ship?.phase !== 'needs-you' || previous?.phase === 'needs-you') return null;
	const reason = change.ship.needsYou?.reason;
	return {
		level: 'warning',
		message: reason
			? `${workstreamName} needs you · ${needsYouReasonLabel(reason, null)}`
			: `${workstreamName} needs you`,
	};
}
