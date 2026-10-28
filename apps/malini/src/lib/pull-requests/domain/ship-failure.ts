import { scheduleTime } from '$contract/automation-trigger';
import type { ShipFailure, ShipStateRecord, ShipStep } from '$contract/pull-requests';

export type ShipFailureSource = Pick<
	ShipStateRecord,
	| 'phase'
	| 'step'
	| 'pullRequestNumber'
	| 'lastError'
	| 'githubSaid'
	| 'failures'
	| 'failedSince'
	| 'nextAttemptAt'
	| 'updatedAt'
>;

export type CodeSpan = Readonly<{ text: string; code: boolean }>;

type FailedWork =
	| 'open-draft'
	| 'open-pull-request'
	| 'push'
	| 'mark-ready'
	| 'update-branch'
	| 'merge'
	| 'archive';

const FAILED_WORK: Readonly<Record<FailedWork, Readonly<{ label: string; title: string }>>> = {
	'open-draft': { label: "Couldn't open draft", title: "Malini couldn't open the draft" },
	'open-pull-request': {
		label: "Couldn't open pull request",
		title: "Malini couldn't open the pull request",
	},
	push: { label: "Couldn't push", title: "Malini couldn't push" },
	'mark-ready': {
		label: "Couldn't mark ready",
		title: "Malini couldn't mark the pull request ready",
	},
	'update-branch': { label: "Couldn't update branch", title: "Malini couldn't update the branch" },
	merge: { label: "Couldn't merge", title: "Malini couldn't merge" },
	archive: { label: "Couldn't archive", title: "Malini couldn't archive the workstream" },
};

const STEP_WORK: Readonly<Partial<Record<ShipStep, FailedWork>>> = {
	pushing: 'push',
	'marking-ready': 'mark-ready',
	'updating-branch': 'update-branch',
	merging: 'merge',
	archiving: 'archive',
};

export function shipFailure(ship: ShipFailureSource | null): ShipFailure | null {
	if (!ship || ship.failures === 0 || ship.lastError === null) return null;
	if (ship.phase !== 'draft' && ship.phase !== 'queued') return null;
	const failed = FAILED_WORK[failedWork(ship)];
	return {
		stage: ship.phase === 'queued' ? 'merge' : 'draft',
		label: failed.label,
		title: failed.title,
		reason: ship.lastError,
		githubSaid: ship.githubSaid,
		tries: ship.failures,
		since: clock(ship.failedSince ?? ship.updatedAt),
		nextTry: ship.nextAttemptAt === null ? null : clock(ship.nextAttemptAt),
	};
}

export function failureTries(failure: ShipFailure): string {
	return `${failure.tries} ${failure.tries === 1 ? 'try' : 'tries'}`;
}

export function failureNextTry(failure: ShipFailure): string {
	return failure.nextTry === null ? 'retrying now' : `next at ${failure.nextTry}`;
}

export function codeSpans(text: string): readonly CodeSpan[] {
	return text
		.split(/(`[^`\n]+`)/u)
		.filter((part) => part.length > 0)
		.map((part) =>
			part.length > 2 && part.startsWith('`') && part.endsWith('`')
				? { text: part.slice(1, -1), code: true }
				: { text: part, code: false },
		);
}

function failedWork(ship: ShipFailureSource): FailedWork {
	const queued = ship.phase === 'queued';
	if (ship.step === 'opening-draft') return queued ? 'open-pull-request' : 'open-draft';
	const atStep = ship.step === null ? undefined : STEP_WORK[ship.step];
	if (atStep) return atStep;
	if (queued) return 'merge';
	return ship.pullRequestNumber === null ? 'open-draft' : 'push';
}

function clock(iso: string): string {
	const at = new Date(iso);
	return scheduleTime({ hour: at.getHours(), minute: at.getMinutes() });
}
