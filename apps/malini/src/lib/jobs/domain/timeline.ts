import type {
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
	TimelineWorkstream,
} from '$contract/jobs';

export const MALINI_LANE = 'malini';

export const FACT_CHANNELS: ReadonlySet<string> = new Set([
	'chat:turn-finished',
	'repositories:workstream-created',
	'repositories:workstream-removed',
	'repositories:workstream-head-moved',
	'repositories:workstream-pushed',
	'repositories:workstream-merge-conflicted',
	'pull-requests:local-base-synced',
	'app:updated',
]);

type ItemBase = Readonly<{
	id: string;
	laneId: string;
	start: number;
	end: number | null;
	chainId: string;
	causes: readonly string[];
}>;

export type TimelineItem =
	| (ItemBase & Readonly<{ kind: 'event'; event: LoggedEventRecord }>)
	| (ItemBase & Readonly<{ kind: 'run'; run: TimelineJobRun }>)
	| (ItemBase & Readonly<{ kind: 'turn'; turn: TimelineChatTurn }>)
	| (ItemBase & Readonly<{ kind: 'decision'; decision: ReconcilerDecisionRecord }>);

export type TimelineLane = Readonly<{
	id: string;
	workstream: TimelineWorkstream | null;
	depth: number;
	items: readonly TimelineItem[];
}>;

export type TimelineLayout = Readonly<{
	since: number;
	until: number;
	lanes: readonly TimelineLane[];
	items: ReadonlyMap<string, TimelineItem>;
	effects: ReadonlyMap<string, readonly string[]>;
}>;

export type TimelineOptions = Readonly<{ everyEvent: boolean }>;

export function timelineLayout(record: TimelineRecord, options: TimelineOptions): TimelineLayout {
	const until = Date.parse(record.until);
	const shown = (event: LoggedEventRecord): boolean =>
		options.everyEvent || FACT_CHANNELS.has(event.channel);
	const hiddenCauses = new Map(
		record.events
			.filter((event) => !shown(event))
			.map((event) => [eventId(event.id), event.cause ? [causeId(event.cause)] : []] as const),
	);
	const reach = (ids: readonly string[]): string[] =>
		ids.flatMap((id) => hiddenCauses.get(id) ?? [id]);
	const drafts: TimelineItem[] = [
		...record.events.filter(shown).map((event): TimelineItem => ({
			id: eventId(event.id),
			kind: 'event',
			laneId: event.workstreamId ?? MALINI_LANE,
			start: Date.parse(event.emittedAt),
			end: null,
			chainId: event.chainId,
			causes: event.cause ? [causeId(event.cause)] : [],
			event,
		})),
		...record.runs.map((run): TimelineItem => ({
			id: runId(run.id),
			kind: 'run',
			laneId: run.workstreamId ?? MALINI_LANE,
			start: Date.parse(run.startedAt ?? run.createdAt),
			end: run.finishedAt === null ? until : Date.parse(run.finishedAt),
			chainId: run.chainId,
			causes: [
				...(run.parentRunId === null ? [] : [runId(run.parentRunId)]),
				...run.eventIds.map(eventId),
				...record.decisions
					.filter((decision) => decision.jobRunId === run.id)
					.map((decision) => decisionId(decision.id)),
			],
			run,
		})),
		...record.turns.map((turn): TimelineItem => ({
			id: turnId(turn.runId),
			kind: 'turn',
			laneId: turn.workstreamId,
			start: Date.parse(turn.startedAt),
			end: turn.finishedAt === null ? until : Date.parse(turn.finishedAt),
			chainId: turn.chainId,
			causes: turnCauses(turn, record),
			turn,
		})),
		...record.decisions.map((decision): TimelineItem => ({
			id: decisionId(decision.id),
			kind: 'decision',
			laneId: decision.workstreamId ?? MALINI_LANE,
			start: Date.parse(decision.createdAt),
			end: null,
			chainId: decision.chainId,
			causes: [eventId(decision.eventId)],
			decision,
		})),
	];
	const known = new Set(drafts.map((item) => item.id));
	const items = drafts
		.map((item) => ({
			...item,
			causes: [...new Set(reach(item.causes))].filter(
				(cause) => cause !== item.id && known.has(cause),
			),
		}))
		.sort((left, right) => left.start - right.start);
	const effects = new Map<string, string[]>();
	for (const item of items) {
		for (const cause of item.causes) effects.set(cause, [...(effects.get(cause) ?? []), item.id]);
	}
	return {
		since: Date.parse(record.since),
		until,
		lanes: lanesOf(record.workstreams, items),
		items: new Map(items.map((item) => [item.id, item])),
		effects,
	};
}

export function chainItemIds(layout: TimelineLayout, itemId: string): ReadonlySet<string> {
	const chainId = layout.items.get(itemId)?.chainId;
	if (chainId === undefined) return new Set();
	return new Set(
		[...layout.items.values()].filter((item) => item.chainId === chainId).map((item) => item.id),
	);
}

export function timelineShare(layout: TimelineLayout, at: number): number {
	const span = layout.until - layout.since;
	if (span <= 0) return 0;
	return Math.min(1, Math.max(0, (at - layout.since) / span));
}

function turnCauses(turn: TimelineChatTurn, record: TimelineRecord): string[] {
	if (turn.causeEventId !== null) {
		const wake = record.decisions.find(
			(decision) =>
				decision.eventId === turn.causeEventId &&
				decision.candidates[decision.chosen]?.kind === 'wake-chat',
		);
		return [wake ? decisionId(wake.id) : eventId(turn.causeEventId)];
	}
	if (turn.from === null) return [];
	const starter = record.turns
		.filter(
			(other) =>
				other.workstreamId === turn.from &&
				other.chainId === turn.chainId &&
				other.startedAt <= turn.startedAt,
		)
		.at(-1);
	return starter ? [turnId(starter.runId)] : [];
}

function lanesOf(
	workstreams: readonly TimelineWorkstream[],
	items: readonly TimelineItem[],
): TimelineLane[] {
	const byLane = new Map<string, TimelineItem[]>();
	for (const item of items) byLane.set(item.laneId, [...(byLane.get(item.laneId) ?? []), item]);
	const known = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
	const firstAt = (id: string): number => byLane.get(id)?.[0]?.start ?? Number.POSITIVE_INFINITY;
	const children = (parent: string | null): TimelineWorkstream[] =>
		workstreams
			.filter((workstream) =>
				parent === null
					? workstream.startedBy === null || !known.has(workstream.startedBy)
					: workstream.startedBy === parent,
			)
			.sort((left, right) => firstAt(left.id) - firstAt(right.id));
	const lanes: TimelineLane[] = [];
	const visit = (workstream: TimelineWorkstream, depth: number): void => {
		if (lanes.some((lane) => lane.id === workstream.id)) return;
		lanes.push({ id: workstream.id, workstream, depth, items: byLane.get(workstream.id) ?? [] });
		for (const child of children(workstream.id)) visit(child, depth + 1);
	};
	for (const root of children(null)) visit(root, 0);
	const orphans = [...byLane.keys()].filter(
		(id) => id !== MALINI_LANE && !lanes.some((lane) => lane.id === id),
	);
	const malini = byLane.get(MALINI_LANE);
	return [
		...(malini ? [{ id: MALINI_LANE, workstream: null, depth: 0, items: malini }] : []),
		...lanes.filter((lane) => lane.items.length > 0 || hasBusyChild(lane, lanes)),
		...orphans.map((id) => ({ id, workstream: null, depth: 0, items: byLane.get(id) ?? [] })),
	];
}

function hasBusyChild(lane: TimelineLane, lanes: readonly TimelineLane[]): boolean {
	return lanes.some((other) => other.workstream?.startedBy === lane.id && other.items.length > 0);
}

function causeId(cause: NonNullable<LoggedEventRecord['cause']>): string {
	return cause.kind === 'job-run' ? runId(cause.id) : turnId(cause.id);
}

function eventId(id: number): string {
	return `event:${id}`;
}

function runId(id: string): string {
	return `run:${id}`;
}

function turnId(id: string): string {
	return `turn:${id}`;
}

function decisionId(id: string): string {
	return `decision:${id}`;
}
