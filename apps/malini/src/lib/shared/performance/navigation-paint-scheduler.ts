export type NavigationFrameScheduler = (callback: () => void) => () => void;
export type NavigationTimeoutScheduler = (callback: () => void, delayMs: number) => () => void;
export type NavigationTaskScheduler = (callback: () => void) => () => void;
export type NavigationPaintReleaseSource = 'post-frame-task' | 'fallback-timeout';
export type NavigationPaintScheduler = (
	callback: (source: NavigationPaintReleaseSource) => void,
) => () => void;

export const NAVIGATION_AFTER_PAINT_FALLBACK_MS = 32;

export function scheduleAfterNavigationPaint(
	callback: (source: NavigationPaintReleaseSource) => void,
	scheduleFrame: NavigationFrameScheduler = scheduleBrowserFrame,
	scheduleTimeout: NavigationTimeoutScheduler = scheduleBrowserTimeout,
	scheduleTask: NavigationTaskScheduler = scheduleBrowserTask,
): () => void {
	let live = true;
	let paintReleased = false;
	let fallbackReported = false;
	let cancelPostFrame = (): void => undefined;

	const reportFallback = (): void => {
		if (!live || paintReleased || fallbackReported) return;
		fallbackReported = true;
		callback('fallback-timeout');
	};
	const releasePaint = (): void => {
		if (!live || paintReleased) return;
		paintReleased = true;
		callback('post-frame-task');
	};
	const cancelTimeout = scheduleTimeout(reportFallback, NAVIGATION_AFTER_PAINT_FALLBACK_MS);
	const cancelFirstFrame = scheduleFrame(() => {
		cancelPostFrame = scheduleTask(releasePaint);
	});

	return () => {
		live = false;
		cancelFirstFrame();
		cancelPostFrame();
		cancelTimeout();
	};
}

export function scheduleAfterSettledNavigationPaint(
	callback: () => void,
	schedulePaint: NavigationPaintScheduler = (next) => scheduleAfterNavigationPaint(next),
): () => void {
	let live = true;
	let cancelSettledPaint = (): void => undefined;
	const cancelDestinationPaint = schedulePaint((releaseSource) => {
		if (!live || releaseSource === 'fallback-timeout') return;
		cancelSettledPaint = schedulePaint((settledReleaseSource) => {
			if (!live || settledReleaseSource === 'fallback-timeout') return;
			live = false;
			callback();
		});
	});

	return () => {
		if (!live) return;
		live = false;
		cancelDestinationPaint();
		cancelSettledPaint();
	};
}

function scheduleBrowserFrame(callback: () => void): () => void {
	let live = true;
	if (typeof globalThis.requestAnimationFrame === 'function') {
		const frame = globalThis.requestAnimationFrame(() => {
			if (live) callback();
		});
		return () => {
			live = false;
			globalThis.cancelAnimationFrame(frame);
		};
	}

	queueMicrotask(() => {
		if (live) callback();
	});
	return () => {
		live = false;
	};
}

function scheduleBrowserTimeout(callback: () => void, delayMs: number): () => void {
	const timeout = globalThis.setTimeout(callback, delayMs);
	return () => globalThis.clearTimeout(timeout);
}

function scheduleBrowserTask(callback: () => void): () => void {
	if (typeof globalThis.MessageChannel !== 'function') {
		return scheduleBrowserTimeout(callback, 0);
	}

	let live = true;
	const channel = new globalThis.MessageChannel();
	const close = (): void => {
		channel.port1.close();
		channel.port2.close();
	};
	channel.port1.onmessage = () => {
		if (!live) return;
		live = false;
		close();
		callback();
	};
	channel.port2.postMessage(undefined);
	return () => {
		if (!live) return;
		live = false;
		close();
	};
}
