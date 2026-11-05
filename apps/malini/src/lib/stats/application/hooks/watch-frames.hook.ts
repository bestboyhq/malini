import type { RendererFrame } from '$contract/stats';
import { withoutExplainedGaps } from '$lib/stats/domain/frames';
import { framesService } from '$lib/stats/infrastructure/services/frames.service';

const REPORT_AFTER_MS = 1_000;

export function watchFramesHook(): () => void {
	let pending: RendererFrame[] = [];
	let reportTimer: ReturnType<typeof setTimeout> | null = null;

	const report = (): void => {
		reportTimer = null;
		const frames = withoutExplainedGaps(pending);
		pending = [];
		if (frames.length === 0) return;
		void (async () => {
			try {
				await framesService.record(frames);
			} catch (error) {
				console.warn('[malini frames] slow frames were not journaled', error);
			}
		})();
	};
	const collect = (frames: readonly RendererFrame[]): void => {
		pending.push(...frames);
		reportTimer ??= setTimeout(report, REPORT_AFTER_MS);
	};

	const stopWatchingLongFrames = framesService.watchLongFrames(collect);
	const stopWatchingFrameGaps = framesService.watchFrameGaps(collect);
	return () => {
		stopWatchingFrameGaps();
		stopWatchingLongFrames();
		if (reportTimer !== null) clearTimeout(reportTimer);
		report();
	};
}
