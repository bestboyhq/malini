type TimedAnimation = {
	startTime: CSSNumberish | null;
	readonly playState: AnimationPlayState;
	readonly effect: { getTiming(): EffectTiming } | null;
};

type AnimationHost = {
	getAnimations(): TimedAnimation[];
	addEventListener(type: 'animationstart', listener: () => void): void;
	removeEventListener(type: 'animationstart', listener: () => void): void;
};

export function installLoopingAnimationSync(host: AnimationHost = document): () => void {
	const pinLoopsToTimelineOrigin = (): void => {
		for (const animation of host.getAnimations()) {
			const loops = animation.effect?.getTiming().iterations === Infinity;
			if (loops && animation.playState === 'running' && animation.startTime !== 0) {
				animation.startTime = 0;
			}
		}
	};
	host.addEventListener('animationstart', pinLoopsToTimelineOrigin);
	return () => host.removeEventListener('animationstart', pinLoopsToTimelineOrigin);
}
