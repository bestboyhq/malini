type TimedAnimation = {
	startTime: CSSNumberish | null;
	readonly playState: AnimationPlayState;
	readonly animationName?: string;
	readonly effect: { getTiming(): EffectTiming } | null;
};

type AnimationTarget = { getAnimations(): TimedAnimation[] };

type AnimationStart = { readonly target: unknown; readonly animationName: string };

type AnimationHost = {
	addEventListener(type: 'animationstart', listener: (event: AnimationStart) => void): void;
	removeEventListener(type: 'animationstart', listener: (event: AnimationStart) => void): void;
};

export function installLoopingAnimationSync(host: AnimationHost = document): () => void {
	const pinLoopToTimelineOrigin = (event: AnimationStart): void => {
		if (!isAnimationTarget(event.target)) return;
		for (const animation of event.target.getAnimations()) {
			if (animation.animationName !== event.animationName) continue;
			const loops = animation.effect?.getTiming().iterations === Infinity;
			if (loops && animation.playState === 'running' && animation.startTime !== 0) {
				animation.startTime = 0;
			}
		}
	};
	host.addEventListener('animationstart', pinLoopToTimelineOrigin);
	return () => host.removeEventListener('animationstart', pinLoopToTimelineOrigin);
}

function isAnimationTarget(target: unknown): target is AnimationTarget {
	return (
		typeof target === 'object' &&
		target !== null &&
		'getAnimations' in target &&
		typeof target.getAnimations === 'function'
	);
}
