import {
	EVENT_ROWS,
	LISTENERS,
	type EventRow,
	type Hop,
	type MapNode,
} from '$lib/jobs/domain/explorer';

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;

export type Flight = Readonly<{ id: string; hops: readonly Hop[] }>;

export type Lit = Readonly<{ wires: ReadonlySet<string>; nodes: ReadonlySet<MapNode> }>;

export type Route = Readonly<{ d: string; tip: string }>;

export const STRUCTURE: readonly Hop[] = [
	['you', 'chats'],
	['you', 'jobs'],
	['agents', 'event:turn-ended'],
	['agents', 'event:tool-called'],
	['agents', 'event:job-run'],
	['git', 'event:committed'],
	['git', 'event:pushed'],
	['git', 'event:conflicted'],
	['github', 'event:pull-request'],
	['malini', 'event:workstream-started'],
	['malini', 'event:workstream-archived'],
	['malini', 'listener:resume'],
	['clock', 'listener:schedules'],
	['event:turn-ended', 'listener:reconciler'],
	['event:conflicted', 'listener:reconciler'],
	['event:job-run', 'listener:reconciler'],
	['event:job-run', 'listener:thens'],
	['event:pull-request', 'listener:merge-queue'],
	['listener:reconciler', 'chats'],
	['listener:reconciler', 'jobs'],
	['listener:triggers', 'jobs'],
	['listener:thens', 'jobs'],
	['listener:merge-queue', 'jobs'],
	['listener:resume', 'chats'],
	['listener:schedules', 'jobs'],
];

export type MapLayout = Readonly<{
	width: number;
	height: number;
	boxes: ReadonlyMap<MapNode, Box>;
	domains: Readonly<{ sources: Box; log: Box; listeners: Box; work: Box }>;
	route: (hop: Hop) => Route | null;
}>;

type Point = readonly [number, number];

const SIDE = 20;
const PAD = 12;
const TOP = 28;
const INSET = 20;
const YOU_H = 36;
const ROW_H = 28;
const ROW_PITCH = 34;
const LISTENER_H = 44;
const LISTENER_PITCH = 52;
const LOG_TOP = TOP + INSET + YOU_H + 16;
const LOG_H = INSET + EVENT_ROWS.length * ROW_PITCH + PAD - (ROW_PITCH - ROW_H);
const LANE = 14;
const CHATS_H = 196;
const WORK_GAP = 18;
const LOOP = 12;
const RADIUS = 7;
const TIP = 6;
const BASE = { sources: 140, log: 200, listeners: 224, work: 190 } as const;
const BASE_TOTAL = BASE.sources + BASE.log + BASE.listeners + BASE.work;
const IDEAL_GAP = 44;
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.3;

export const MAP_MIN_WIDTH = 880;

export function mapLayout(available: number): MapLayout {
	const width = Math.max(MAP_MIN_WIDTH, available);
	const inner = width - SIDE * 2 - 4 * PAD * 2;
	const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (inner - 3 * IDEAL_GAP) / BASE_TOTAL));
	const sources = Math.round(BASE.sources * scale);
	const log = Math.round(BASE.log * scale);
	const listeners = Math.round(BASE.listeners * scale);
	const work = Math.round(BASE.work * scale);
	const gap = (inner - sources - log - listeners - work) / 3;

	const bottom = LOG_TOP + LOG_H;
	const lane = bottom + LANE;
	const height = lane + LANE;

	const sourcesDomain: Box = { x: SIDE, y: TOP, w: sources + PAD * 2, h: bottom - TOP };
	const logDomain: Box = {
		x: sourcesDomain.x + sourcesDomain.w + gap,
		y: LOG_TOP,
		w: log + PAD * 2,
		h: LOG_H,
	};
	const listenersDomain: Box = {
		x: logDomain.x + logDomain.w + gap,
		y: LOG_TOP,
		w: listeners + PAD * 2,
		h: LOG_H,
	};
	const workDomain: Box = {
		x: listenersDomain.x + listenersDomain.w + gap,
		y: TOP,
		w: work + PAD * 2,
		h: bottom - TOP,
	};
	const rowY = (row: EventRow): number => LOG_TOP + INSET + EVENT_ROWS.indexOf(row) * ROW_PITCH;
	const rowsSpan = (first: EventRow, last: EventRow): Readonly<{ y: number; h: number }> => ({
		y: rowY(first),
		h: rowY(last) + ROW_H - rowY(first),
	});

	const boxes = new Map<MapNode, Box>();
	const sourceX = sourcesDomain.x + PAD;
	boxes.set('you', { x: sourceX, y: TOP + INSET, w: sources, h: YOU_H });
	boxes.set('agents', { x: sourceX, w: sources, ...rowsSpan('turn-ended', 'job-run') });
	boxes.set('git', { x: sourceX, w: sources, ...rowsSpan('committed', 'conflicted') });
	boxes.set('github', { x: sourceX, w: sources, ...rowsSpan('pull-request', 'pull-request') });
	boxes.set('malini', {
		x: sourceX,
		w: sources,
		...rowsSpan('workstream-started', 'workstream-archived'),
	});
	boxes.set('clock', { x: sourceX, w: sources, ...rowsSpan('other', 'other') });
	EVENT_ROWS.forEach((row) => {
		boxes.set(`event:${row}`, { x: logDomain.x + PAD, y: rowY(row), w: log, h: ROW_H });
	});
	LISTENERS.forEach((listener, index) => {
		boxes.set(`listener:${listener}`, {
			x: listenersDomain.x + PAD,
			y: LOG_TOP + INSET + index * LISTENER_PITCH,
			w: listeners,
			h: LISTENER_H,
		});
	});
	const chats: Box = { x: workDomain.x + PAD, y: TOP + INSET, w: work, h: CHATS_H };
	const jobsY = chats.y + CHATS_H + WORK_GAP;
	boxes.set('chats', chats);
	boxes.set('jobs', { x: chats.x, y: jobsY, w: work, h: bottom - PAD - jobsY });

	const gapMid = [
		sourcesDomain.x + sourcesDomain.w + gap / 2,
		logDomain.x + logDomain.w + gap / 2,
		listenersDomain.x + listenersDomain.w + gap / 2,
	] as const;
	const box = (node: MapNode): Box | null => boxes.get(node) ?? null;
	const midY = (target: Box): number => target.y + target.h / 2;
	const columnOf = (node: MapNode): 0 | 1 | 2 => {
		if (node.startsWith('event:')) return 1;
		return node.startsWith('listener:') ? 2 : 0;
	};

	const points = ([from, to]: Hop, a: Box, b: Box): readonly Point[] => {
		if (from === to) {
			const x = a.x + a.w - 46;
			const edge = from === 'chats' ? a.y : a.y + a.h;
			const out = from === 'chats' ? edge - LOOP : edge + LOOP;
			return [
				[x, edge],
				[x, out],
				[x + 24, out],
				[x + 24, edge],
			];
		}
		if (from === 'chats' && to === 'jobs') {
			const x = a.x + a.w - 30;
			return [
				[x, a.y + a.h],
				[x, b.y],
			];
		}
		const start: Point = [a.x + a.w, midY(a)];
		const end: Point = [b.x, midY(b)];
		if (from === 'you') {
			if (to === 'chats') return [start, [b.x, start[1]]];
			return [start, [gapMid[2], start[1]], [gapMid[2], end[1]], end];
		}
		if (columnOf(from) === 0 && columnOf(to) === 2) {
			const under: readonly Point[] =
				from === 'clock'
					? [
							[a.x + a.w - 24, a.y + a.h],
							[a.x + a.w - 24, lane],
						]
					: [start, [gapMid[0], start[1]], [gapMid[0], lane]];
			return [...under, [gapMid[1], lane], [gapMid[1], end[1]], end];
		}
		const mid = gapMid[columnOf(from)];
		return [start, [mid, start[1]], [mid, end[1]], end];
	};

	const route = (hop: Hop): Route | null => {
		const a = box(hop[0]);
		const b = box(hop[1]);
		if (a === null || b === null) return null;
		const line = points(hop, a, b);
		return { d: path(line), tip: tip(line) };
	};

	return {
		width,
		height,
		boxes,
		domains: {
			sources: sourcesDomain,
			log: logDomain,
			listeners: listenersDomain,
			work: workDomain,
		},
		route,
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
