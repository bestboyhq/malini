import { describe, expect, it } from 'vitest';
import { installLoopingAnimationSync } from './looping-animations';

type FakeAnimation = {
	startTime: number | null;
	playState: AnimationPlayState;
	effect: { getTiming(): EffectTiming };
};

function animation(
	iterations: number,
	playState: AnimationPlayState,
	startTime: number | null,
): FakeAnimation {
	return { startTime, playState, effect: { getTiming: () => ({ iterations }) } };
}

describe('looping animation sync', () => {
	it('pins every running loop to the timeline origin whenever an animation starts', () => {
		const listeners = new Set<() => void>();
		const loop = animation(Infinity, 'running', 1840);
		const pendingLoop = animation(Infinity, 'running', null);
		const pausedLoop = animation(Infinity, 'paused', null);
		const oneShot = animation(1, 'running', 1840);
		const release = installLoopingAnimationSync({
			getAnimations: () => [loop, pendingLoop, pausedLoop, oneShot],
			addEventListener: (_type, listener) => listeners.add(listener),
			removeEventListener: (_type, listener) => listeners.delete(listener),
		});

		for (const listener of listeners) listener();
		expect([loop, pendingLoop, pausedLoop, oneShot].map(({ startTime }) => startTime)).toEqual([
			0,
			0,
			null,
			1840,
		]);

		release();
		expect(listeners.size).toBe(0);
	});
});
