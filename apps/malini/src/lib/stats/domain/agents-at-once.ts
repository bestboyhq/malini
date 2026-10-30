import { localDate } from './activity';

export type RunSpan = Readonly<{ start: number; end: number }>;

export type AgentsAtOnce = Readonly<{
	mean: number;
	p50: number;
	p90: number;
	max: number;
	days: ReadonlyMap<string, number>;
}>;

type DayTime = { agentTime: number; busyTime: number };

export function agentsAtOnce(spans: readonly RunSpan[]): AgentsAtOnce | null {
	const edges = spans
		.filter((span) => span.end > span.start)
		.flatMap((span) => [
			{ at: span.start, step: 1 },
			{ at: span.end, step: -1 },
		])
		.sort((left, right) => left.at - right.at || left.step - right.step);
	const timeAtLevel = new Map<number, number>();
	const days = new Map<string, DayTime>();
	let running = 0;
	let since = 0;
	for (const edge of edges) {
		if (running > 0 && edge.at > since) {
			timeAtLevel.set(running, (timeAtLevel.get(running) ?? 0) + edge.at - since);
			addToDays(days, since, edge.at, running);
		}
		running += edge.step;
		since = edge.at;
	}
	const levels = [...timeAtLevel].sort(([left], [right]) => left - right);
	const busyTime = levels.reduce((total, [, time]) => total + time, 0);
	if (busyTime === 0) return null;
	const agentTime = levels.reduce((total, [level, time]) => total + level * time, 0);
	return {
		mean: agentTime / busyTime,
		p50: levelAt(levels, busyTime, 0.5),
		p90: levelAt(levels, busyTime, 0.9),
		max: levels.at(-1)?.[0] ?? 0,
		days: new Map([...days].map(([day, time]) => [day, time.agentTime / time.busyTime])),
	};
}

function addToDays(days: Map<string, DayTime>, from: number, to: number, running: number): void {
	for (let start = from; start < to;) {
		const at = new Date(start);
		const end = Math.min(to, new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime());
		const date = localDate(at);
		const day = days.get(date) ?? { agentTime: 0, busyTime: 0 };
		day.agentTime += running * (end - start);
		day.busyTime += end - start;
		days.set(date, day);
		start = end;
	}
}

function levelAt(
	levels: readonly (readonly [number, number])[],
	total: number,
	share: number,
): number {
	let covered = 0;
	for (const [level, time] of levels) {
		covered += time;
		if (covered >= share * total) return level;
	}
	return levels.at(-1)?.[0] ?? 0;
}
