import type { EventChannel } from '$contract/events';
import type {
	EventCause,
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
	TimelineWorkstream,
} from '$contract/jobs';
import type { ReconcilerRule } from './reconciler';

export type Source = 'you' | 'agent' | 'git' | 'github' | 'malini' | 'clock';

export const EVENT_ROWS = [
	'button-clicked',
	'workstream-opened',
	'turn-finished',
	'tool-called',
	'job-started',
	'job-finished',
	'head-moved',
	'files-changed',
	'branch-pushed',
	'merge-conflicted',
	'base-overlapped',
	'pull-request-changed',
	'workstream-created',
	'workstream-archived',
	'malini-started',
	'malini-updated',
	'time-reached',
	'other',
] as const;

export type EventRow = (typeof EVENT_ROWS)[number];

export const ROW_SOURCES: Readonly<Record<EventRow, Source | null>> = {
	'button-clicked': 'you',
	'workstream-opened': 'you',
	'turn-finished': 'agent',
	'tool-called': 'agent',
	'job-started': 'agent',
	'job-finished': 'agent',
	'head-moved': 'git',
	'files-changed': 'git',
	'branch-pushed': 'git',
	'merge-conflicted': 'git',
	'base-overlapped': 'git',
	'pull-request-changed': 'github',
	'workstream-created': 'malini',
	'workstream-archived': 'malini',
	'malini-started': 'malini',
	'malini-updated': 'malini',
	'time-reached': 'clock',
	other: null,
};

export type WorkNode = 'chats' | 'jobs';

export type MapNode =
	'you' | WorkNode | 'reconciler' | `event:${EventRow}` | `rule:${ReconcilerRule}`;

export type Hop = readonly [MapNode, MapNode];

type ItemBase = Readonly<{
	id: string;
	at: number;
	end: number | null;
	chainId: string;
	cause: string | null;
	workstreamId: string | null;
	hops: readonly Hop[];
}>;

export type ExplorerItem =
	| (ItemBase & Readonly<{ kind: 'event'; event: LoggedEventRecord; row: EventRow }>)
	| (ItemBase & Readonly<{ kind: 'run'; run: TimelineJobRun }>)
	| (ItemBase & Readonly<{ kind: 'turn'; turn: TimelineChatTurn }>)
	| (ItemBase & Readonly<{ kind: 'decision'; decision: ReconcilerDecisionRecord }>);

export type Explorer = Readonly<{
	since: number;
	until: number;
	items: readonly ExplorerItem[];
	byId: ReadonlyMap<string, ExplorerItem>;
	counts: ReadonlyMap<MapNode, number>;
	wires: ReadonlyMap<string, number>;
	workstreams: ReadonlyMap<string, TimelineWorkstream>;
}>;

export type Working = Readonly<{
	turns: readonly TimelineChatTurn[];
	runs: readonly TimelineJobRun[];
	waiting: number;
}>;

const ROWS: Readonly<Record<string, EventRow>> = {
	'pull-requests:button-clicked': 'button-clicked',
	'pull-requests:workstream-opened': 'workstream-opened',
	'chat:turn-finished': 'turn-finished',
	'jobs:tool-called': 'tool-called',
	'jobs:run-started': 'job-started',
	'jobs:run-finished': 'job-finished',
	'repositories:workstream-head-moved': 'head-moved',
	'repositories:workstream-files-changed': 'files-changed',
	'repositories:workstream-pushed': 'branch-pushed',
	'repositories:workstream-merge-conflicted': 'merge-conflicted',
	'repositories:workstream-base-overlapped': 'base-overlapped',
	'pull-requests:pull-request-changed': 'pull-request-changed',
	'repositories:workstream-created': 'workstream-created',
	'repositories:workstream-removed': 'workstream-archived',
	'app:started': 'malini-started',
	'app:updated': 'malini-updated',
	'jobs:time-reached': 'time-reached',
} satisfies Partial<Record<EventChannel, EventRow>>;

const FACT_CHANNELS: ReadonlySet<string> = new Set<EventChannel>([
	'pull-requests:button-clicked',
	'pull-requests:workstream-opened',
	'chat:turn-finished',
	'repositories:workstream-created',
	'repositories:workstream-removed',
	'repositories:workstream-head-moved',
	'repositories:workstream-pushed',
	'repositories:workstream-merge-conflicted',
	'repositories:workstream-base-overlapped',
	'pull-requests:local-base-synced',
	'pull-requests:pull-request-changed',
	'app:started',
	'app:updated',
	'jobs:time-reached',
]);

export function eventRow(channel: string): EventRow {
	return ROWS[channel] ?? 'other';
}

export function wireKey([from, to]: Hop): string {
	return `${from}>${to}`;
}

export function explorer(record: TimelineRecord): Explorer {
	const events = new Map(record.events.map((event) => [event.id, event]));
	const wakes = new Map(
		record.decisions
			.filter((decision) => decision.candidates[decision.chosen]?.kind === 'wake-chat')
			.map((decision) => [decision.eventId, decision]),
	);
	const drafts: ExplorerItem[] = [
		...record.events.map(eventItem),
		...record.runs.map((run) => runItem(run, record.decisions, events)),
		...record.turns.map((turn) => turnItem(turn, record.turns, wakes)),
		...record.decisions.map(decisionItem),
	];
	const known = new Set(drafts.map((item) => item.id));
	const items = drafts
		.map((item) => (item.cause === null || known.has(item.cause) ? item : { ...item, cause: null }))
		.sort((left, right) => left.at - right.at);
	return {
		since: Date.parse(record.since),
		until: Date.parse(record.until),
		items,
		byId: new Map(items.map((item) => [item.id, item])),
		counts: countNodes(items, record.channelCounts),
		wires: countWires(items),
		workstreams: new Map(record.workstreams.map((workstream) => [workstream.id, workstream])),
	};
}

export function isFact(item: ExplorerItem): boolean {
	if (item.kind !== 'event') return true;
	if (FACT_CHANNELS.has(item.event.channel)) return true;
	return item.event.channel === 'pull-requests:ship-changed' && isMerged(item.event.payload);
}

export function listed(explorer: Explorer, everyEvent: boolean): readonly ExplorerItem[] {
	return everyEvent ? explorer.items : explorer.items.filter(isFact);
}

export function chainItems(explorer: Explorer, chainId: string): readonly ExplorerItem[] {
	const steps = explorer.items.filter((item) => item.chainId === chainId);
	const causes = steps.flatMap((item) => {
		const cause = item.cause === null ? undefined : explorer.byId.get(item.cause);
		return cause === undefined || cause.chainId === chainId ? [] : [cause];
	});
	return [...new Map([...causes, ...steps].map((item) => [item.id, item])).values()].sort(
		(left, right) => left.at - right.at,
	);
}

export function through(explorer: Explorer, node: MapNode): readonly ExplorerItem[] {
	return explorer.items.filter((item) =>
		item.hops.some(([from, to]) => from === node || to === node),
	);
}

export function workingAt(explorer: Explorer, at: number): Working {
	const turns: TimelineChatTurn[] = [];
	const runs: TimelineJobRun[] = [];
	let waiting = 0;
	for (const item of explorer.items) {
		if (item.kind === 'turn' && item.at <= at && (item.end ?? Infinity) > at) turns.push(item.turn);
		if (item.kind !== 'run') continue;
		const created = Date.parse(item.run.createdAt);
		const started = item.run.startedAt === null ? null : Date.parse(item.run.startedAt);
		const finished = item.run.finishedAt === null ? Infinity : Date.parse(item.run.finishedAt);
		if (started !== null && started <= at && finished > at) runs.push(item.run);
		else if (created <= at && (started ?? finished) > at) waiting += 1;
	}
	return { turns, runs, waiting };
}

function eventItem(event: LoggedEventRecord): ExplorerItem {
	const row = eventRow(event.channel);
	return {
		id: eventId(event.id),
		kind: 'event',
		event,
		row,
		at: Date.parse(event.emittedAt),
		end: null,
		chainId: event.chainId,
		cause: event.cause === null ? null : causeId(event.cause),
		workstreamId: event.workstreamId,
		hops: [[`event:${row}`, 'reconciler']],
	};
}

function runItem(
	run: TimelineJobRun,
	decisions: readonly ReconcilerDecisionRecord[],
	events: ReadonlyMap<number, LoggedEventRecord>,
): ExplorerItem {
	const decision = decisions.find((candidate) => candidate.jobRunId === run.id) ?? null;
	const trigger = run.eventIds.map((id) => events.get(id)).find((event) => event !== undefined);
	return {
		id: runId(run.id),
		kind: 'run',
		run,
		at: Date.parse(run.startedAt ?? run.createdAt),
		end: run.finishedAt === null ? null : Date.parse(run.finishedAt),
		chainId: run.chainId,
		cause:
			(run.parentRunId === null ? null : runId(run.parentRunId)) ??
			(decision === null ? null : decisionId(decision.id)) ??
			(trigger === undefined ? null : eventId(trigger.id)) ??
			(run.chatAfterRunId === null ? null : turnId(run.chatAfterRunId)),
		workstreamId: run.workstreamId,
		hops: runHops(run),
	};
}

function runHops(run: TimelineJobRun): Hop[] {
	switch (run.origin) {
		case 'trigger':
			return [
				['reconciler', 'rule:triggers'],
				['rule:triggers', 'jobs'],
			];
		case 'then':
			if (run.eventIds.length === 0) return [['jobs', 'jobs']];
			return [
				['reconciler', 'rule:thens'],
				['rule:thens', 'jobs'],
			];
		case 'schedule':
			return [
				['reconciler', 'rule:schedules'],
				['rule:schedules', 'jobs'],
			];
		case 'merge-queue':
			return [
				['reconciler', 'rule:shipping'],
				['rule:shipping', 'jobs'],
			];
		case 'compatibility':
			return [
				['reconciler', 'rule:compatibility'],
				['rule:compatibility', 'jobs'],
			];
		case 'reconciler':
			return [['rule:model', 'jobs']];
		case 'manual':
			if (run.chatAfterRunId !== null) return [['chats', 'jobs']];
			return run.parentRunId === null ? [['you', 'jobs']] : [['jobs', 'jobs']];
	}
}

function turnItem(
	turn: TimelineChatTurn,
	turns: readonly TimelineChatTurn[],
	wakes: ReadonlyMap<number, ReconcilerDecisionRecord>,
): ExplorerItem {
	return {
		id: turnId(turn.runId),
		kind: 'turn',
		turn,
		at: Date.parse(turn.startedAt),
		end: turn.finishedAt === null ? null : Date.parse(turn.finishedAt),
		chainId: turn.chainId,
		cause: turnCause(turn, turns, wakes),
		workstreamId: turn.workstreamId,
		hops: turnHops(turn, wakes),
	};
}

function turnCause(
	turn: TimelineChatTurn,
	turns: readonly TimelineChatTurn[],
	wakes: ReadonlyMap<number, ReconcilerDecisionRecord>,
): string | null {
	if (turn.causeEventId !== null) {
		const wake = wakes.get(turn.causeEventId);
		return wake ? decisionId(wake.id) : eventId(turn.causeEventId);
	}
	if (turn.from === null) return null;
	const starter = turns
		.filter(
			(other) =>
				other.workstreamId === turn.from &&
				other.chainId === turn.chainId &&
				other.startedAt <= turn.startedAt,
		)
		.at(-1);
	return starter ? turnId(starter.runId) : null;
}

function turnHops(
	turn: TimelineChatTurn,
	wakes: ReadonlyMap<number, ReconcilerDecisionRecord>,
): Hop[] {
	if (turn.resumed) {
		return [
			['reconciler', 'rule:resume'],
			['rule:resume', 'chats'],
		];
	}
	if (turn.causeEventId !== null && wakes.has(turn.causeEventId)) return [['rule:model', 'chats']];
	if (turn.causeEventId !== null) {
		return [
			['reconciler', 'rule:deliveries'],
			['rule:deliveries', 'chats'],
		];
	}
	return turn.from === null ? [['you', 'chats']] : [['chats', 'chats']];
}

function decisionItem(decision: ReconcilerDecisionRecord): ExplorerItem {
	return {
		id: decisionId(decision.id),
		kind: 'decision',
		decision,
		at: Date.parse(decision.createdAt),
		end: null,
		chainId: decision.chainId,
		cause: eventId(decision.eventId),
		workstreamId: decision.workstreamId,
		hops: [['reconciler', 'rule:model']],
	};
}

function countNodes(
	items: readonly ExplorerItem[],
	channelCounts: Readonly<Record<string, number>>,
): Map<MapNode, number> {
	const counts = new Map<MapNode, number>();
	const add = (node: MapNode, amount = 1): void => {
		counts.set(node, (counts.get(node) ?? 0) + amount);
	};
	for (const [channel, total] of Object.entries(channelCounts)) {
		add(`event:${eventRow(channel)}`, total);
		add('reconciler', total);
	}
	for (const item of items) {
		if (item.kind === 'turn') add('chats');
		if (item.kind === 'run') add('jobs');
		if (item.kind === 'decision') add('rule:model');
		for (const [from] of item.hops) {
			if (from === 'you' || (from.startsWith('rule:') && from !== 'rule:model')) {
				add(from);
			}
		}
	}
	return counts;
}

function countWires(items: readonly ExplorerItem[]): Map<string, number> {
	const wires = new Map<string, number>();
	for (const item of items) {
		for (const hop of item.hops) wires.set(wireKey(hop), (wires.get(wireKey(hop)) ?? 0) + 1);
	}
	return wires;
}

function isMerged(payload: unknown): boolean {
	return typeof payload === 'object' && payload !== null && 'merged' in payload;
}

function causeId(cause: EventCause): string {
	switch (cause.kind) {
		case 'job-run':
			return runId(cause.id);
		case 'chat-turn':
			return turnId(cause.id);
		case 'event':
			return `event:${cause.id}`;
	}
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
