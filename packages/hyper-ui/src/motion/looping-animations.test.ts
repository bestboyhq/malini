import { describe, expect, it } from 'vitest';
import { installLoopingAnimationSync } from './looping-animations';

type FakeAnimation = {
	startTime: number | null;
	playState: AnimationPlayState;
	animationName: string;
	effect: { getTiming(): EffectTiming };
};

function animation(
	animationName: string,
	iterations: number,
	playState: AnimationPlayState,
	startTime: number | null,
): FakeAnimation {
	return { animationName, startTime, playState, effect: { getTiming: () => ({ iterations }) } };
}

describe('looping animation sync', () => {
	it('pins a loop that starts to the timeline origin and leaves everything else alone', () => {
		type Listener = (event: { target: unknown; animationName: string }) => void;
		const listeners = new Set<Listener>();
		const loop = animation('breathe', Infinity, 'running', 1840);
		const pendingLoop = animation('breathe', Infinity, 'running', null);
		const pausedLoop = animation('breathe', Infinity, 'paused', null);
		const oneShot = animation('breathe', 1, 'running', 1840);
		const otherLoop = animation('shimmer', Infinity, 'running', 1840);
		const target = { getAnimations: () => [loop, pendingLoop, pausedLoop, oneShot, otherLoop] };
		const release = installLoopingAnimationSync({
			addEventListener: (_type, listener) => listeners.add(listener),
			removeEventListener: (_type, listener) => listeners.delete(listener),
		});

		for (const listener of listeners) listener({ target, animationName: 'breathe' });
		expect(
			[loop, pendingLoop, pausedLoop, oneShot, otherLoop].map(({ startTime }) => startTime),
		).toEqual([0, 0, null, 1840, 1840]);

		release();
		expect(listeners.size).toBe(0);
	});
});
