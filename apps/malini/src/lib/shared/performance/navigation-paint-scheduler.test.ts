import { describe, expect, it, vi } from 'vitest';
import {
	NAVIGATION_AFTER_PAINT_FALLBACK_MS,
	scheduleAfterNavigationPaint,
	scheduleAfterSettledNavigationPaint,
	type NavigationFrameScheduler,
	type NavigationPaintReleaseSource,
	type NavigationPaintScheduler,
	type NavigationTaskScheduler,
	type NavigationTimeoutScheduler,
} from './navigation-paint-scheduler';

function manualCallbacks(): {
	frames: NavigationFrameScheduler;
	timeout: NavigationTimeoutScheduler;
	task: NavigationTaskScheduler;
	flushFrame(): void;
	flushTimeout(delayMs: number): void;
	flushTask(): void;
	delays(): readonly number[];
	cancelledDelays(): readonly number[];
	taskWasCancelled(): boolean;
} {
	const frames: Array<() => void> = [];
	const timeouts = new Map<number, Array<{ callback: () => void; cancelled: boolean }>>();
	const tasks: Array<{ callback: () => void; cancelled: boolean }> = [];
	const cancelledDelays: number[] = [];
	let taskCancellationObserved = false;
	return {
		frames: (callback) => {
			frames.push(callback);
			return () => undefined;
		},
		timeout: (callback, delay) => {
			const scheduled = { callback, cancelled: false };
			timeouts.set(delay, [...(timeouts.get(delay) ?? []), scheduled]);
			return () => {
				scheduled.cancelled = true;
				cancelledDelays.push(delay);
			};
		},
		task: (callback) => {
			const scheduled = { callback, cancelled: false };
			tasks.push(scheduled);
			return () => {
				scheduled.cancelled = true;
				taskCancellationObserved = true;
			};
		},
		flushFrame: () => frames.shift()?.(),
		flushTimeout: (delay) => {
			const scheduled = timeouts.get(delay)?.shift();
			if (scheduled && !scheduled.cancelled) scheduled.callback();
		},
		flushTask: () => {
			const scheduled = tasks.shift();
			if (scheduled && !scheduled.cancelled) scheduled.callback();
		},
		delays: () => [...timeouts.keys()],
		cancelledDelays: () => cancelledDelays,
		taskWasCancelled: () => taskCancellationObserved,
	};
}

describe('navigation paint scheduler', () => {
	it('runs in a zero-delay task after the first rendering opportunity', () => {
		const scheduler = manualCallbacks();
		const callback = vi.fn();
		scheduleAfterNavigationPaint(callback, scheduler.frames, scheduler.timeout, scheduler.task);

		scheduler.flushFrame();
		expect(callback).not.toHaveBeenCalled();
		expect(scheduler.delays()).not.toContain(0);
		scheduler.flushTask();
		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith('post-frame-task');
	});

	it('reports the bounded fallback without treating it as paint evidence', () => {
		const scheduler = manualCallbacks();
		const callback = vi.fn();
		scheduleAfterNavigationPaint(callback, scheduler.frames, scheduler.timeout, scheduler.task);

		expect(scheduler.delays()).toContain(NAVIGATION_AFTER_PAINT_FALLBACK_MS);
		scheduler.flushTimeout(NAVIGATION_AFTER_PAINT_FALLBACK_MS);
		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith('fallback-timeout');

		scheduler.flushFrame();
		scheduler.flushTask();
		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenLastCalledWith('post-frame-task');
	});

	it('reports each signal at most once and never reports fallback after paint', () => {
		const scheduler = manualCallbacks();
		const callback = vi.fn();
		scheduleAfterNavigationPaint(callback, scheduler.frames, scheduler.timeout, scheduler.task);

		scheduler.flushFrame();
		scheduler.flushTask();
		scheduler.flushTimeout(NAVIGATION_AFTER_PAINT_FALLBACK_MS);
		scheduler.flushFrame();
		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith('post-frame-task');
	});

	it('cancels the frame, post-frame task, and fallback', () => {
		const scheduler = manualCallbacks();
		const callback = vi.fn();
		const cancel = scheduleAfterNavigationPaint(
			callback,
			scheduler.frames,
			scheduler.timeout,
			scheduler.task,
		);

		scheduler.flushFrame();
		cancel();
		scheduler.flushTask();
		scheduler.flushTimeout(NAVIGATION_AFTER_PAINT_FALLBACK_MS);
		expect(callback).not.toHaveBeenCalled();
		expect(scheduler.cancelledDelays()).toContain(NAVIGATION_AFTER_PAINT_FALLBACK_MS);
		expect(scheduler.taskWasCancelled()).toBe(true);
	});

	it('releases background work only after two proven paint boundaries', () => {
		const pending: Array<(source: NavigationPaintReleaseSource) => void> = [];
		const schedulePaint: NavigationPaintScheduler = (callback) => {
			pending.push(callback);
			return () => undefined;
		};
		const callback = vi.fn();
		scheduleAfterSettledNavigationPaint(callback, schedulePaint);

		expect(pending).toHaveLength(1);
		pending[0]?.('fallback-timeout');
		expect(callback).not.toHaveBeenCalled();
		expect(pending).toHaveLength(1);

		pending[0]?.('post-frame-task');
		expect(pending).toHaveLength(2);
		pending[1]?.('fallback-timeout');
		expect(callback).not.toHaveBeenCalled();

		pending[1]?.('post-frame-task');
		expect(callback).toHaveBeenCalledOnce();
	});

	it('cancels both settled-paint stages before background work is released', () => {
		const pending: Array<{
			callback: (source: NavigationPaintReleaseSource) => void;
			cancelled: boolean;
		}> = [];
		const schedulePaint: NavigationPaintScheduler = (callback) => {
			const stage = { callback, cancelled: false };
			pending.push(stage);
			return () => {
				stage.cancelled = true;
			};
		};
		const callback = vi.fn();
		const cancel = scheduleAfterSettledNavigationPaint(callback, schedulePaint);

		pending[0]?.callback('post-frame-task');
		cancel();
		pending[1]?.callback('post-frame-task');

		expect(pending.map(({ cancelled }) => cancelled)).toEqual([true, true]);
		expect(callback).not.toHaveBeenCalled();
	});
});
