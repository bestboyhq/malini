import type { RendererFrame } from '$contract/stats';

export const JANK_MS = 50;

export function droppedFrames(durationMs: number, displayHz: number): number {
	return Math.max(0, Math.round((durationMs * displayHz) / 1_000) - 1);
}

export function withoutExplainedGaps(frames: readonly RendererFrame[]): RendererFrame[] {
	const longFrames = frames.filter((frame) => frame.kind === 'long-frame');
	return frames.filter(
		(frame) =>
			frame.kind === 'long-frame' ||
			frame.durationMs - longFrames.reduce((sum, long) => sum + pageWorkMs(long, frame), 0) >=
				JANK_MS,
	);
}

function pageWorkMs(long: RendererFrame, gap: RendererFrame): number {
	const blockingMs = long.blockingMs ?? 0;
	return blockingMs > 0 ? Math.min(overlapMs(long, gap), blockingMs + JANK_MS) : 0;
}

function overlapMs(left: RendererFrame, right: RendererFrame): number {
	const start = Math.max(left.startedAt, right.startedAt);
	const end = Math.min(left.startedAt + left.durationMs, right.startedAt + right.durationMs);
	return Math.max(0, end - start);
}
