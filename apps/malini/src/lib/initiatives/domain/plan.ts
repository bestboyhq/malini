import type {
	Initiative,
	InitiativeDependency,
	PlanRemoteChange,
	PlanRemoteChangeKind,
	ShareAcceptedEvent,
	ShareRequest,
} from '$contract/initiatives';
import type { WidgetSize } from '$contract/widgets';
import { dateOf, initiativeFinished, initiativesOn, type StandingOf } from './initiative';

export type DueLabel = Readonly<{ text: string; late: boolean }>;

export type PlanDay = Readonly<{ day: string | null; outcomes: readonly Initiative[] }>;

export const PLAN_MEDIUM_ROWS = 3;

export const PLAN_PULL_EVERY_MS = 30_000;

const DAY_MS = 86_400_000;

const CHANGE_VERBS: Readonly<Record<PlanRemoteChangeKind, string>> = {
	added: 'added',
	renamed: 'renamed',
	closed: 'closed',
	reopened: 'reopened',
	dated: 'moved',
	removed: 'removed',
};

export function planOrder(initiatives: readonly Initiative[]): readonly Initiative[] {
	return [...initiatives].sort((a, b) => {
		if (a.dueOn === b.dueOn) return 0;
		if (a.dueOn === null) return 1;
		if (b.dueOn === null) return -1;
		return a.dueOn < b.dueOn ? -1 : 1;
	});
}

export function planDays(initiatives: readonly Initiative[]): readonly PlanDay[] {
	const ordered = planOrder(initiatives);
	return [...new Set(ordered.map(({ dueOn }) => dueOn))].map((day) => ({
		day,
		outcomes: initiativesOn(ordered, day),
	}));
}

export function daysUntil(day: string, today: string): number {
	return Math.round((dateOf(day).getTime() - dateOf(today).getTime()) / DAY_MS);
}

export function dueLabel(dueOn: string | null, today: string, finished: boolean): DueLabel {
	if (dueOn === null) return { text: 'No date', late: false };
	const days = daysUntil(dueOn, today);
	if (days < 0 && !finished) return { text: `${-days} d late`, late: true };
	const date = dateOf(dueOn);
	return {
		text: `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`,
		late: false,
	};
}

export function nextOutcome(
	ordered: readonly Initiative[],
	today: string,
	standingOf: StandingOf,
): Initiative | null {
	const open = ordered.filter((initiative) => !initiativeFinished(initiative, standingOf));
	return (
		open.find((initiative) => initiative.dueOn !== null && initiative.dueOn >= today) ??
		open[0] ??
		null
	);
}

export function outcomesFor(
	size: WidgetSize,
	ordered: readonly Initiative[],
	today: string,
	standingOf: StandingOf,
): readonly Initiative[] {
	if (size === 'large') return ordered;
	if (size === 'medium') {
		return ordered
			.filter((initiative) => !initiativeFinished(initiative, standingOf))
			.slice(0, PLAN_MEDIUM_ROWS);
	}
	const next = nextOutcome(ordered, today, standingOf);
	return next ? [next] : [];
}

export function servesWorkstream(
	dependency: InitiativeDependency,
	workstreamId: string | null,
): boolean {
	return (
		workstreamId !== null &&
		dependency.workstreams.some((workstream) => workstream.workstreamId === workstreamId)
	);
}

export function syncedLabel(syncedAt: string | null, now: number): string {
	const at = syncedAt === null ? Number.NaN : Date.parse(syncedAt);
	if (Number.isNaN(at)) return 'Not shared yet';
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	if (seconds < 3) return 'Shared just now';
	if (seconds < 60) return `Shared ${seconds} s ago`;
	if (seconds < 3600) return `Shared ${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86_400) return `Shared ${Math.floor(seconds / 3600)} h ago`;
	return `Shared ${Math.floor(seconds / 86_400)} d ago`;
}

export function remoteChangeLine(change: PlanRemoteChange): string {
	return `${change.actor ?? 'Someone'} ${CHANGE_VERBS[change.kind]} ${change.title}`;
}

export function peopleLine(people: readonly string[]): string {
	const last = people.at(-1) ?? 'Someone';
	return people.length < 2 ? last : `${people.slice(0, -1).join(', ')} and ${last}`;
}

export function shareRequestLine(request: ShareRequest): string {
	const verb = request.people.length > 1 ? 'want' : 'wants';
	return `${peopleLine(request.people)} ${verb} to share a plan. Only collaborators of ${request.repositoryFullName} see it`;
}

export function shareAcceptedLine(event: ShareAcceptedEvent): string {
	return `${event.owner} said yes. The plan of ${event.repositoryFullName} is shared`;
}
