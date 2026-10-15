import type { ResourceSample } from '$contract/stats';

export type MemoryLine = Readonly<{ line: string; area: string; spanMs: number }>;

export function memoryLine(
	samples: readonly ResourceSample[],
	windowMs: number,
	width: number,
	height: number,
): MemoryLine | null {
	const last = samples.at(-1);
	if (!last) return null;
	const shown = samples.filter((sample) => sample.sampledAt >= last.sampledAt - windowMs);
	const first = shown[0];
	if (!first || shown.length < 2) return null;
	const spanMs = last.sampledAt - first.sampledAt;
	if (spanMs <= 0) return null;
	const peak = Math.max(...shown.map((sample) => sample.memoryBytes)) * 1.15;
	const points = shown.map((sample) => {
		const x = ((sample.sampledAt - first.sampledAt) / spanMs) * width;
		const y = height - (sample.memoryBytes / peak) * height;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});
	const line = `M${points.join('L')}`;
	return { line, area: `${line}L${width},${height}L0,${height}Z`, spanMs };
}

export function memorySpanLabel(spanMs: number): string {
	const minutes = Math.round(spanMs / 60_000);
	if (minutes >= 60) return 'Past hour';
	if (minutes < 1) return 'Past minute';
	return `Past ${minutes} min`;
}
