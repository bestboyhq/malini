import type {
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
	TimelineWorkstream,
} from '$contract/jobs';

export const SOURCES = ['you', 'agents', 'git', 'github', 'malini', 'clock'] as const;

export type SourceNode = (typeof SOURCES)[number];

export const EVENT_ROWS = [
	'turn-finished',
	'tool-called',
	'job-started',
	'job-finished',
	'head-moved',
	'branch-pushed',
	'merge-conflicted',
	'pull-request-changed',
	'workstream-created',
	'workstream-archived',
	'other',
] as const;

export type EventRow = (typeof EVENT_ROWS)[number];

export const LISTENERS = [
	'triggers',
	'thens',
	'model',
	'merge-queue',
	'resume',
	'schedules',
] as const;

export type Listener = (typeof LISTENERS)[number];

export type WorkNode = 'chats' | 'jobs';

export type MapNode =
	SourceNode | WorkNode | 'reconciler' | `event:${EventRow}` | `listener:${Listener}`;

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
	'chat:turn-finished': 'turn-finished',
	'jobs:tool-called': 'tool-called',
	'jobs:run-started': 'job-started',
	'jobs:run-finished': 'job-finished',
	'repositories:workstream-head-moved': 'head-moved',
	'repositories:workstream-pushed': 'branch-pushed',
	'repositories:workstream-merge-conflicted': 'merge-conflicted',
	'pull-requests:pull-request-changed': 'pull-request-changed',
	'repositories:workstream-created': 'workstream-created',
	'repositories:workstream-removed': 'workstream-archived',
};

const AGENT_CHANNELS: ReadonlySet<string> = new Set([
	'jobs:tool-called',
	'jobs:run-started',
	'jobs:run-finished',
]);

const GIT_CHANNELS: ReadonlySet<string> = new Set([
	'repositories:workstream-head-moved',
	'repositories:workstream-pushed',
	'repositories:workstream-merge-conflicted',
	'repositories:workstream-files-changed',
	'pull-requests:local-base-synced',
]);

const GITHUB_CHANNELS: ReadonlySet<string> = new Set(['pull-requests:pull-request-changed']);

const STARTERS: ReadonlySet<MapNode> = new Set<MapNode>(['you', 'clock']);

const FACT_CHANNELS: ReadonlySet<string> = new Set([
	'chat:turn-finished',
	'repositories:workstream-created',
	'repositories:workstream-removed',
	'repositories:workstream-head-moved',
	'repositories:workstream-pushed',
	'repositories:workstream-merge-conflicted',
	'pull-requests:local-base-synced',
	'pull-requests:pull-request-changed',
	'app:updated',
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
	return explorer.items.filter((item) => item.chainId === chainId);
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
		cause:
			event.cause === null
				? null
				: event.cause.kind === 'job-run'
					? runId(event.cause.id)
					: turnId(event.cause.id),
		workstreamId: event.workstreamId,
		hops: [
			[emitterOf(event.channel), `event:${row}`],
			[`event:${row}`, 'reconciler'],
		],
	};
}

function emitterOf(channel: string): SourceNode {
	if (channel.startsWith('chat:') || AGENT_CHANNELS.has(channel)) return 'agents';
	if (GIT_CHANNELS.has(channel)) return 'git';
	if (GITHUB_CHANNELS.has(channel)) return 'github';
	return 'malini';
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
				['reconciler', 'listener:triggers'],
				['listener:triggers', 'jobs'],
			];
		case 'then':
			if (run.eventIds.length === 0) return [['jobs', 'jobs']];
			return [
				['reconciler', 'listener:thens'],
				['listener:thens', 'jobs'],
			];
		case 'schedule':
			return [
				['clock', 'listener:schedules'],
				['listener:schedules', 'jobs'],
			];
		case 'merge-queue':
			return [
				['github', 'listener:merge-queue'],
				['listener:merge-queue', 'jobs'],
			];
		case 'reconciler':
			return [['listener:model', 'jobs']];
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
		hops: turnHops(turn),
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

function turnHops(turn: TimelineChatTurn): Hop[] {
	if (turn.resumed) {
		return [
			['malini', 'listener:resume'],
			['listener:resume', 'chats'],
		];
	}
	if (turn.causeEventId !== null) return [['listener:model', 'chats']];
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
		hops: [['reconciler', 'listener:model']],
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
		add(emitterOf(channel), total);
		add('reconciler', total);
	}
	for (const item of items) {
		if (item.kind === 'turn') add('chats');
		if (item.kind === 'run') add('jobs');
		if (item.kind === 'decision') add('listener:model');
		for (const [from] of item.hops) {
			if (STARTERS.has(from) || (from.startsWith('listener:') && from !== 'listener:model')) {
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
