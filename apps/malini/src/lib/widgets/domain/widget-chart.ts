import type { WidgetChart, WidgetChartSeries } from '$contract/widgets';

export type ChartDetail = 'tiny' | 'medium' | 'large';

export type ChartPoint = Readonly<{ x: number; y: number }>;

export type ChartScale = Readonly<{ low: number; high: number; ticks: readonly number[] }>;

export type BarLayout = Readonly<{ width: number; offsets: readonly number[] }>;

export const CHART_TINY_WIDTH = 140;

export const CHART_TINY_HEIGHT = 64;

export const CHART_LARGE_WIDTH = 240;

export const CHART_LARGE_HEIGHT = 140;

const FEW_BARS = 8;

const COUNT = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function chartDetail(width: number, height: number): ChartDetail {
	if (width < CHART_TINY_WIDTH || height < CHART_TINY_HEIGHT) return 'tiny';
	return width >= CHART_LARGE_WIDTH && height >= CHART_LARGE_HEIGHT ? 'large' : 'medium';
}

export function chartScale(values: readonly number[], tickCount: number): ChartScale {
	const low = Math.min(0, ...values);
	const high = Math.max(4, ...values);
	const step = tickStep(high - low, tickCount);
	const from = Math.floor(low / step);
	const to = Math.ceil(high / step);
	const ticks = Array.from({ length: to - from + 1 }, (_, index) => tidy((from + index) * step));
	return { low: from * step, high: to * step, ticks };
}

export function sparkScale(values: readonly number[], fromZero: boolean): ChartScale {
	const low = fromZero ? Math.min(0, ...values) : Math.min(...values);
	const high = Math.max(...values);
	if (low < high) return { low, high, ticks: [] };
	return fromZero ? { low, high: low + 1, ticks: [] } : { low: low - 1, high: high + 1, ticks: [] };
}

export function chartValues(chart: WidgetChart): readonly number[] {
	return chart.series.flatMap(({ values }) => values.flatMap((value) => value ?? []));
}

export function pointCount(chart: WidgetChart): number {
	return Math.max(0, ...chart.series.map(({ values }) => values.length));
}

export function lastValue({ values }: WidgetChartSeries): number | null {
	return [...values].reverse().find((value) => value !== null) ?? null;
}

export function chartCount(value: number): string {
	return Math.abs(value) < 10_000 ? COUNT.format(value) : COMPACT.format(value);
}

export function labelIndexes(count: number, slots: number): readonly number[] {
	if (count <= slots) return Array.from({ length: count }, (_, index) => index);
	const step = (count - 1) / (slots - 1);
	return Array.from({ length: slots }, (_, index) => Math.round(index * step));
}

export function lineRuns(points: readonly (ChartPoint | null)[]): readonly ChartPoint[][] {
	const runs: ChartPoint[][] = [[]];
	for (const point of points) {
		if (point === null) runs.push([]);
		else runs.at(-1)?.push(point);
	}
	return runs.filter((run) => run.length > 0);
}

export function monotonePath(points: readonly ChartPoint[]): string {
	const first = points[0];
	if (first === undefined) return '';
	const tangents = monotoneTangents(points);
	let path = `M${first.x},${first.y}`;
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];
		if (from === undefined || to === undefined) continue;
		const third = (to.x - from.x) / 3;
		const start = from.y + third * (tangents[index - 1] ?? 0);
		const end = to.y - third * (tangents[index] ?? 0);
		path += `C${from.x + third},${start},${to.x - third},${end},${to.x},${to.y}`;
	}
	return path;
}

export function areaPath(points: readonly ChartPoint[], baseline: number): string {
	const first = points[0];
	const last = points.at(-1);
	if (first === undefined || last === undefined) return '';
	return `${monotonePath(points)}L${last.x},${baseline}L${first.x},${baseline}Z`;
}

export function barLayout(slot: number, count: number, series: number): BarLayout {
	const gap = series > 1 ? 2 : 0;
	const share = series > 1 ? 0.72 : 0.55;
	const most = count <= FEW_BARS ? 24 : 16;
	const room = (slot * share - gap * (series - 1)) / series;
	const width = Math.min(most, Math.max(Math.min(3, (slot * 0.8) / series), room));
	const offsets = Array.from(
		{ length: series },
		(_, index) => (index - (series - 1) / 2) * (width + gap),
	);
	return { width, offsets };
}

export function barPath(center: number, top: number, bottom: number, width: number): string {
	const height = bottom - top;
	if (height <= 0 || width <= 0) return '';
	const radius = Math.min(4, height, width / 2);
	const left = center - width / 2;
	const right = left + width;
	return `M${left},${bottom}V${top + radius}Q${left},${top} ${left + radius},${top}H${right - radius}Q${right},${top} ${right},${top + radius}V${bottom}Z`;
}

function monotoneTangents(points: readonly ChartPoint[]): readonly number[] {
	const slopes = points.slice(1).map((point, index) => {
		const before = points[index];
		return before === undefined ? 0 : (point.y - before.y) / (point.x - before.x || 1);
	});
	if (slopes.length < 2) return points.map(() => slopes[0] ?? 0);
	const inner = slopes.slice(1).map((slope, index) => {
		const before = slopes[index] ?? 0;
		const bound = Math.min(Math.abs(before), Math.abs(slope), Math.abs(before + slope) / 4);
		return (Math.sign(before) + Math.sign(slope)) * bound;
	});
	const first = inner[0] ?? 0;
	const last = inner.at(-1) ?? 0;
	return [(3 * (slopes[0] ?? 0) - first) / 2, ...inner, (3 * (slopes.at(-1) ?? 0) - last) / 2];
}

function tickStep(span: number, count: number): number {
	const raw = span / Math.max(1, count);
	const power = 10 ** Math.floor(Math.log10(raw));
	const error = raw / power;
	if (error >= Math.sqrt(50)) return 10 * power;
	if (error >= Math.sqrt(10)) return 5 * power;
	return error >= Math.sqrt(2) ? 2 * power : power;
}

function tidy(value: number): number {
	return Number(value.toPrecision(12));
}
