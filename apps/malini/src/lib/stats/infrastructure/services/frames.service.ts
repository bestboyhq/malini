import type { RendererFrame } from '$contract/stats';
import { JANK_MS } from '$lib/stats/domain/frames';
import { FrameMapper } from '$lib/stats/infrastructure/mappers/frame.mapper';
import { currentDiagnosticRoute } from '$shared/errors/diagnostic-route';
import { invoke } from '$shared/port/invoke';

const LONG_ANIMATION_FRAME = 'long-animation-frame';
const INPUT_EVENTS = ['wheel', 'pointerdown', 'pointermove', 'keydown'] as const;
const SAMPLE_AFTER_INPUT_MS = 1_000;
const MAX_GAP_MS = 10_000;

class FramesService {
	async record(frames: readonly RendererFrame[]): Promise<void> {
		await invoke('stats.record-frames', { frames });
	}

	watchLongFrames(listener: (frames: readonly RendererFrame[]) => void): () => void {
		if (!PerformanceObserver.supportedEntryTypes.includes(LONG_ANIMATION_FRAME)) {
			return () => undefined;
		}
		const observer = new PerformanceObserver((list) =>
			listener(FrameMapper.fromRawList(list.getEntries(), frameContext())),
		);
		observer.observe({ type: LONG_ANIMATION_FRAME });
		return () => observer.disconnect();
	}

	watchFrameGaps(listener: (frames: readonly RendererFrame[]) => void): () => void {
		let sampleUntil = 0;
		let request: number | null = null;
		let previous: number | null = null;
		const sample = (at: number): void => {
			const gap = previous === null ? 0 : at - previous;
			if (previous !== null && gap >= JANK_MS && gap <= MAX_GAP_MS && !document.hidden) {
				listener([FrameMapper.fromGap(previous, gap, frameContext())]);
			}
			const sampling = at < sampleUntil;
			previous = sampling ? at : null;
			request = sampling ? requestAnimationFrame(sample) : null;
		};
		const onInput = (): void => {
			sampleUntil = performance.now() + SAMPLE_AFTER_INPUT_MS;
			request ??= requestAnimationFrame(sample);
		};
		for (const type of INPUT_EVENTS) {
			window.addEventListener(type, onInput, { capture: true, passive: true });
		}
		return () => {
			for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
			if (request !== null) cancelAnimationFrame(request);
			request = null;
		};
	}
}

function frameContext(): Readonly<{ timeOrigin: number; focused: boolean; route: string }> {
	return {
		timeOrigin: performance.timeOrigin,
		focused: document.hasFocus(),
		route: currentDiagnosticRoute(),
	};
}

export const framesService = new FramesService();
