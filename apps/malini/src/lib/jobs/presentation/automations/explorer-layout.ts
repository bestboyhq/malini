import { EVENT_ROWS, type EventRow, type Hop, type MapNode } from '$lib/jobs/domain/explorer';
import { RECONCILER_RULES, type ReconcilerRule } from '$lib/jobs/domain/reconciler';

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;

export type Flight = Readonly<{ id: string; hops: readonly Hop[] }>;

export type Lit = Readonly<{ wires: ReadonlySet<string>; nodes: ReadonlySet<MapNode> }>;

export type Route = Readonly<{ d: string; tip: string }>;

export type Segment = Readonly<{ id: string; d: string; tip: string | null }>;

export const STRUCTURE: readonly Hop[] = [
	['you', 'chats'],
	['you', 'jobs'],
	...EVENT_ROWS.map((row): Hop => [`event:${row}`, 'reconciler']),
	...RECONCILER_RULES.map((rule): Hop => ['reconciler', `rule:${rule}`]),
	['rule:triggers', 'jobs'],
	['rule:thens', 'jobs'],
	['rule:shipping', 'jobs'],
	['rule:resume', 'chats'],
	['rule:schedules', 'jobs'],
	['rule:compatibility', 'jobs'],
	['rule:model', 'chats'],
	['rule:model', 'jobs'],
	['chats', 'chats'],
	['chats', 'jobs'],
	['jobs', 'jobs'],
];

export type MapLayout = Readonly<{
	width: number;
	height: number;
	boxes: ReadonlyMap<MapNode, Box>;
	domains: Readonly<{ events: Box; work: Box }>;
	segments: readonly Segment[];
	loopLabel: Readonly<{ x: number; y: number }>;
	route: (hop: Hop) => Route | null;
	segmentsOf: (hop: Hop) => readonly string[];
}>;

type Point = readonly [number, number];

const SIDE = 20;
const PAD = 12;
const TOP = 28;
const INSET = 20;
const YOU_H = 36;
const YOU_GAP = 20;
const ROW_H = 26;
const ROW_PITCH = 30;
const REC_PAD = 10;
const REC_HEAD = 44;
const RULE_H = 38;
const RULE_PITCH = 44;
const THEN_H = 22;
const CHATS_H = 190;
const WORK_GAP = 18;
const ASK = 12;
const LOOP_DROP = 26;
const LOOP_INSET = 40;
const RADIUS = 7;
const TIP = 6;
const BASE = { events: 220, reconciler: 270, work: 190 } as const;
const BASE_TOTAL = BASE.events + BASE.reconciler + BASE.work;
const IDEAL_GAP = 56;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.3;
const LOG_TOP = TOP + INSET + YOU_H + YOU_GAP;
const ROWS_TOP = LOG_TOP + INSET;
const ROWS_SPAN = EVENT_ROWS.length * ROW_PITCH - (ROW_PITCH - ROW_H);
const MODEL = RECONCILER_RULES.indexOf('model');
const RECONCILER_H = REC_PAD * 2 + REC_HEAD + RECONCILER_RULES.length * RULE_PITCH + THEN_H - 6;

export const MAP_MIN_WIDTH = 880;

export function mapLayout(available: number): MapLayout {
	const width = Math.max(MAP_MIN_WIDTH, available);
	const scale = Math.min(
		MAX_SCALE,
		Math.max(MIN_SCALE, (width - SIDE * 2 - PAD * 4 - IDEAL_GAP * 2) / BASE_TOTAL),
	);
	const rowW = Math.round(BASE.events * scale);
	const recW = Math.round(BASE.reconciler * scale);
	const workW = Math.round(BASE.work * scale);
	const gap = (width - SIDE * 2 - PAD * 4 - rowW - recW - workW) / 2;
	const bottom = Math.max(ROWS_TOP + ROWS_SPAN + PAD, ROWS_TOP + RECONCILER_H + PAD);
	const loopY = bottom + LOOP_DROP;

	const events: Box = { x: SIDE, y: LOG_TOP, w: rowW + PAD * 2, h: bottom - LOG_TOP };
	const reconciler: Box = { x: events.x + events.w + gap, y: ROWS_TOP, w: recW, h: RECONCILER_H };
	const work: Box = {
		x: reconciler.x + reconciler.w + gap,
		y: TOP,
		w: workW + PAD * 2,
		h: bottom - TOP,
	};
	const you: Box = { x: SIDE + PAD, y: TOP + INSET, w: rowW, h: YOU_H };
	const chats: Box = { x: work.x + PAD, y: TOP + INSET, w: workW, h: CHATS_H };
	const jobsY = chats.y + CHATS_H + WORK_GAP;
	const jobs: Box = { x: chats.x, y: jobsY, w: workW, h: bottom - PAD - jobsY };
	const rows = new Map<EventRow, Box>(
		EVENT_ROWS.map((row, index) => [
			row,
			{ x: SIDE + PAD, y: ROWS_TOP + index * ROW_PITCH, w: rowW, h: ROW_H },
		]),
	);
	const rules = new Map<ReconcilerRule, Box>(
		RECONCILER_RULES.map((rule, index) => [
			rule,
			{
				x: reconciler.x + REC_PAD,
				y: reconciler.y + REC_PAD + REC_HEAD + index * RULE_PITCH + (index >= MODEL ? THEN_H : 0),
				w: reconciler.w - REC_PAD * 2,
				h: RULE_H,
			},
		]),
	);

	const boxes = new Map<MapNode, Box>([
		['you', you],
		['reconciler', reconciler],
		['chats', chats],
		['jobs', jobs],
		...[...rows].map(([row, box]): [MapNode, Box] => [`event:${row}`, box]),
		...[...rules].map(([rule, box]): [MapNode, Box] => [`rule:${rule}`, box]),
	]);

	const mid = (box: Box): number => box.y + box.h / 2;
	const right = (box: Box): number => box.x + box.w;
	const busX = reconciler.x - gap / 2;
	const decided = work.x - Math.min(16, gap / 3);
	const asked = work.x - gap * 0.62;
	const first = rows.get(EVENT_ROWS[0] ?? 'turn-finished') ?? you;
	const last = rows.get(EVENT_ROWS.at(-1) ?? 'other') ?? you;
	const flowY = mid(first);
	const youY = mid(you);
	const decidedJobsY = jobs.y + 24;
	const askedJobsY = jobs.y + 40;
	const askX = right(chats) - 46;
	const handX = right(chats) - 30;
	const loopX = work.x + work.w / 2;
	const loopEnd = events.x + LOOP_INSET;

	const lines = {
		trunk: [
			[right(first), flowY],
			[reconciler.x, flowY],
		],
		bus: [
			[right(last), mid(last)],
			[busX, mid(last)],
			[busX, flowY],
		],
		decidedChats: [
			[right(reconciler), flowY],
			[chats.x, flowY],
		],
		decidedJobs: [
			[right(reconciler), flowY],
			[decided, flowY],
			[decided, decidedJobsY],
			[jobs.x, decidedJobsY],
		],
		youChats: [
			[right(you), youY],
			[chats.x, youY],
		],
		youJobs: [
			[right(you), youY],
			[asked, youY],
			[asked, askedJobsY],
			[jobs.x, askedJobsY],
		],
		askChats: [
			[askX, chats.y],
			[askX, chats.y - ASK],
			[askX + 24, chats.y - ASK],
			[askX + 24, chats.y],
		],
		askJobs: [
			[handX, chats.y + chats.h],
			[handX, jobs.y],
		],
		askJob: [
			[askX, jobs.y + jobs.h],
			[askX, jobs.y + jobs.h + ASK],
			[askX + 24, jobs.y + jobs.h + ASK],
			[askX + 24, jobs.y + jobs.h],
		],
		loop: [
			[loopX, bottom],
			[loopX, loopY],
			[loopEnd, loopY],
			[loopEnd, bottom],
		],
	} satisfies Record<string, readonly Point[]>;

	const stub = (row: EventRow): readonly Point[] => {
		const box = rows.get(row) ?? first;
		return [
			[right(box), mid(box)],
			[busX, mid(box)],
		];
	};

	const segments: Segment[] = [
		{ id: 'trunk', d: path(lines.trunk), tip: tip(lines.trunk) },
		{ id: 'bus', d: path(lines.bus), tip: null },
		...EVENT_ROWS.slice(1, -1).map((row) => ({ id: `stub:${row}`, d: path(stub(row)), tip: null })),
		{ id: 'decided:chats', d: path(lines.decidedChats), tip: tip(lines.decidedChats) },
		{ id: 'decided:jobs', d: path(lines.decidedJobs), tip: tip(lines.decidedJobs) },
		{ id: 'you:chats', d: path(lines.youChats), tip: tip(lines.youChats) },
		{ id: 'you:jobs', d: path(lines.youJobs), tip: tip(lines.youJobs) },
		{ id: 'ask:chats', d: path(lines.askChats), tip: tip(lines.askChats) },
		{ id: 'ask:jobs', d: path(lines.askJobs), tip: tip(lines.askJobs) },
		{ id: 'ask:job', d: path(lines.askJob), tip: tip(lines.askJob) },
		{ id: 'loop', d: path(lines.loop), tip: tip(lines.loop) },
	];

	const points = ([from, to]: Hop): readonly Point[] | null => {
		if (from.startsWith('event:') && to === 'reconciler') {
			const box = boxes.get(from) ?? first;
			if (box === first) return lines.trunk;
			return [
				[right(box), mid(box)],
				[busX, mid(box)],
				[busX, flowY],
				[reconciler.x, flowY],
			];
		}
		if (from.startsWith('rule:')) {
			if (to === 'chats') return lines.decidedChats;
			if (to === 'jobs') return lines.decidedJobs;
		}
		if (from === 'you') return to === 'chats' ? lines.youChats : lines.youJobs;
		if (from === 'chats') return to === 'chats' ? lines.askChats : lines.askJobs;
		if (from === 'jobs' && to === 'jobs') return lines.askJob;
		return null;
	};

	const route = (hop: Hop): Route | null => {
		const line = points(hop);
		return line === null ? null : { d: path(line), tip: tip(line) };
	};

	const segmentsOf = ([from, to]: Hop): readonly string[] => {
		if (from.startsWith('event:') && to === 'reconciler') {
			const row = from.slice('event:'.length);
			if (row === EVENT_ROWS[0]) return ['trunk'];
			return [`stub:${row}`, 'bus', 'trunk'];
		}
		if (from.startsWith('rule:')) return to === 'chats' ? ['decided:chats'] : ['decided:jobs'];
		if (from === 'you') return [to === 'chats' ? 'you:chats' : 'you:jobs'];
		if (from === 'chats') return [to === 'chats' ? 'ask:chats' : 'ask:jobs'];
		if (from === 'jobs' && to === 'jobs') return ['ask:job'];
		return [];
	};

	return {
		width,
		height: loopY + 18,
		boxes,
		domains: { events, work },
		segments,
		loopLabel: { x: (loopX + loopEnd) / 2, y: loopY },
		route,
		segmentsOf,
	};
}

function tip(points: readonly Point[]): string {
	const from = points.at(-2);
	const end = points.at(-1);
	if (from === undefined || end === undefined) return '';
	const length = Math.hypot(end[0] - from[0], end[1] - from[1]);
	const along = [(end[0] - from[0]) / length, (end[1] - from[1]) / length] as const;
	const back = [end[0] - along[0] * TIP, end[1] - along[1] * TIP] as const;
	const side = [-along[1] * TIP * 0.8, along[0] * TIP * 0.8] as const;
	return `M ${back[0] + side[0]} ${back[1] + side[1]} L ${end[0]} ${end[1]} L ${back[0] - side[0]} ${back[1] - side[1]}`;
}

function path(points: readonly Point[]): string {
	const [first, ...rest] = points;
	if (first === undefined) return '';
	let d = `M ${first[0]} ${first[1]}`;
	rest.forEach((point, index) => {
		const previous = points[index] ?? first;
		const next = rest[index + 1];
		if (next === undefined) {
			d += ` L ${point[0]} ${point[1]}`;
			return;
		}
		const into = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
		const out = Math.hypot(next[0] - point[0], next[1] - point[1]);
		const radius = Math.min(RADIUS, into / 2, out / 2);
		if (radius < 0.5) {
			d += ` L ${point[0]} ${point[1]}`;
			return;
		}
		const before = [
			point[0] - ((point[0] - previous[0]) / into) * radius,
			point[1] - ((point[1] - previous[1]) / into) * radius,
		];
		const after = [
			point[0] + ((next[0] - point[0]) / out) * radius,
			point[1] + ((next[1] - point[1]) / out) * radius,
		];
		d += ` L ${before[0]} ${before[1]} Q ${point[0]} ${point[1]} ${after[0]} ${after[1]}`;
	});
	return d;
}
