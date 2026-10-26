import { EVENT_ROWS, LISTENERS, type Hop, type MapNode } from '$lib/jobs/domain/explorer';

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;

export type Flight = Readonly<{ id: string; hops: readonly Hop[] }>;

export type Lit = Readonly<{ wires: ReadonlySet<string>; nodes: ReadonlySet<MapNode> }>;

export const STRUCTURE: readonly Hop[] = [
	['you', 'chats'],
	['you', 'jobs'],
	['chats', 'event:turn-ended'],
	['chats', 'event:tool-called'],
	['chats', 'git'],
	['jobs', 'git'],
	['jobs', 'github'],
	['jobs', 'event:job-run'],
	['git', 'event:committed'],
	['git', 'event:pushed'],
	['git', 'event:conflicted'],
	['github', 'event:pull-request'],
	['malini', 'event:workstream-started'],
	['malini', 'event:workstream-archived'],
	['event:turn-ended', 'listener:reconciler'],
	['event:conflicted', 'listener:reconciler'],
	['event:job-run', 'listener:reconciler'],
	['event:job-run', 'listener:thens'],
	['event:pull-request', 'listener:merge-queue'],
	['malini', 'listener:schedules'],
	['malini', 'listener:resume'],
	['listener:reconciler', 'chats'],
	['listener:reconciler', 'jobs'],
	['listener:thens', 'jobs'],
	['listener:merge-queue', 'jobs'],
	['listener:schedules', 'jobs'],
	['listener:resume', 'chats'],
];

export type MapLayout = Readonly<{
	width: number;
	height: number;
	boxes: ReadonlyMap<MapNode, Box>;
	domains: Readonly<{ work: Box; log: Box; listeners: Box }>;
	route: (hop: Hop) => string | null;
}>;

const LEFT = 44;
const RIGHT = 44;
const PAD = 12;
const TOP = 64;
const INSET = 20;
const ROW_H = 28;
const ROW_PITCH = 34;
const LISTENER_H = 44;
const LISTENER_PITCH = 52;
const DOMAIN_H = INSET + EVENT_ROWS.length * ROW_PITCH + PAD - (ROW_PITCH - ROW_H);
const CHATS_H = 168;
const WORK_GAP = 18;
const LANE = 14;
const RAIL = 46;
const LOOP = 12;
const RADIUS = 7;
const BASE = { work: 190, world: 110, log: 200, listeners: 224 } as const;
const BASE_TOTAL = BASE.work + BASE.world + BASE.log + BASE.listeners;
const IDEAL_GAP = 44;
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.3;

export const MAP_MIN_WIDTH = 880;

export function mapLayout(available: number): MapLayout {
	const width = Math.max(MAP_MIN_WIDTH, available);
	const inner = width - LEFT - RIGHT - 3 * PAD * 2;
	const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (inner - 3 * IDEAL_GAP) / BASE_TOTAL));
	const work = Math.round(BASE.work * scale);
	const world = Math.round(BASE.world * scale);
	const log = Math.round(BASE.log * scale);
	const listeners = Math.round(BASE.listeners * scale);
	const gap = (inner - work - world - log - listeners) / 3;

	const workDomain: Box = { x: LEFT, y: TOP, w: work + PAD * 2, h: DOMAIN_H };
	const worldX = workDomain.x + workDomain.w + gap;
	const logDomain: Box = { x: worldX + world + gap, y: TOP, w: log + PAD * 2, h: DOMAIN_H };
	const listenersDomain: Box = {
		x: logDomain.x + logDomain.w + gap,
		y: TOP,
		w: listeners + PAD * 2,
		h: DOMAIN_H,
	};
	const rowY = (index: number): number => TOP + INSET + index * ROW_PITCH;
	const rowsSpan = (first: number, last: number): Readonly<{ y: number; h: number }> => ({
		y: rowY(first),
		h: rowY(last) + ROW_H - rowY(first),
	});

	const boxes = new Map<MapNode, Box>();
	const chats: Box = { x: LEFT + PAD, y: TOP + INSET, w: work, h: CHATS_H };
	const jobsY = chats.y + CHATS_H + WORK_GAP;
	boxes.set('you', { x: LEFT + PAD, y: 14, w: Math.min(work, 150), h: 36 });
	boxes.set('chats', chats);
	boxes.set('jobs', { x: chats.x, y: jobsY, w: work, h: TOP + DOMAIN_H - PAD - jobsY });
	boxes.set('git', { x: worldX, w: world, ...rowsSpan(2, 4) });
	boxes.set('github', { x: worldX, w: world, ...rowsSpan(5, 5) });
	boxes.set('malini', { x: worldX, w: world, ...rowsSpan(6, 7) });
	EVENT_ROWS.forEach((row, index) => {
		boxes.set(`event:${row}`, { x: logDomain.x + PAD, y: rowY(index), w: log, h: ROW_H });
	});
	LISTENERS.forEach((listener, index) => {
		boxes.set(`listener:${listener}`, {
			x: listenersDomain.x + PAD,
			y: TOP + INSET + index * LISTENER_PITCH,
			w: listeners,
			h: LISTENER_H,
		});
	});

	const domainBottom = TOP + DOMAIN_H;
	const pollsLane = domainBottom + LANE;
	const clockLane = domainBottom + LANE * 2;
	const railY = domainBottom + RAIL;
	const height = railY + 18;
	const busX = listenersDomain.x + listenersDomain.w + 20;
	const inX = LEFT - 18;
	const youLane = LEFT - 30;
	const gapMid = [
		workDomain.x + workDomain.w + gap / 2,
		worldX + world + gap / 2,
		logDomain.x + logDomain.w + gap / 2,
	] as const;

	const box = (node: MapNode): Box | null => boxes.get(node) ?? null;
	const midY = (target: Box): number => target.y + target.h / 2;
	const columnOf = (node: MapNode): number => {
		if (node === 'chats' || node === 'jobs') return 0;
		if (node === 'git' || node === 'github' || node === 'malini') return 1;
		return node.startsWith('event:') ? 2 : 3;
	};

	const route = ([from, to]: Hop): string | null => {
		const a = box(from);
		const b = box(to);
		if (a === null || b === null) return null;
		if (from === to) {
			const x = a.x + a.w - 46;
			const edge = from === 'chats' ? a.y : a.y + a.h;
			const out = from === 'chats' ? edge - LOOP : edge + LOOP;
			return path([
				[x, edge],
				[x, out],
				[x + 24, out],
				[x + 24, edge],
			]);
		}
		if (from === 'you') {
			const entry = midY(b) + (to === 'chats' ? -8 : 8);
			return path([
				[a.x, midY(a)],
				[youLane, midY(a)],
				[youLane, entry],
				[b.x, entry],
			]);
		}
		if (from === 'chats' && to === 'jobs') {
			const x = a.x + a.w - 30;
			return path([
				[x, a.y + a.h],
				[x, b.y],
			]);
		}
		if (to === 'chats' || to === 'jobs') {
			return path([
				[a.x + a.w, midY(a)],
				[busX, midY(a)],
				[busX, railY],
				[inX, railY],
				[inX, midY(b)],
				[b.x, midY(b)],
			]);
		}
		if (from === 'github' || from === 'malini') {
			if (to.startsWith('listener:')) {
				const lane = from === 'github' ? pollsLane : clockLane;
				const down = from === 'github' ? gapMid[1] - 6 : gapMid[1] + 6;
				const up = from === 'github' ? gapMid[2] + 6 : gapMid[2] - 6;
				return path([
					[a.x + a.w, midY(a)],
					[down, midY(a)],
					[down, lane],
					[up, lane],
					[up, midY(b)],
					[b.x, midY(b)],
				]);
			}
		}
		const mid = gapMid[columnOf(from)] ?? gapMid[2];
		return path([
			[a.x + a.w, midY(a)],
			[mid, midY(a)],
			[mid, midY(b)],
			[b.x, midY(b)],
		]);
	};

	return {
		width,
		height,
		boxes,
		domains: { work: workDomain, log: logDomain, listeners: listenersDomain },
		route,
	};
}

function path(points: readonly (readonly [number, number])[]): string {
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
