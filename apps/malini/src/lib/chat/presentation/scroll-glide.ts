export const SCROLL_SPRING_STIFFNESS = 420;

export const SCROLL_GLIDE_SETTLE_PX = 0.5;

export const SCROLL_GLIDE_SETTLE_VELOCITY = 8;

const DEVICE_PIXEL_SNAP_PX = 1;

const FLOAT_SLACK_DEVICE_PX = 1 / 1024;

const AT_TARGET: GlideState = { position: 0, velocity: 0 };

export const GLIDE_SAMPLE_MS = 1000 / 240;

export const GLIDE_KEYFRAMES_PER_SAMPLE = 4;

const GLIDE_KEYFRAME_MS = GLIDE_SAMPLE_MS / GLIDE_KEYFRAMES_PER_SAMPLE;

const OCCLUDED_FRAME_MS = 1000;

const STALLED_FRAME_MS = 34;

export function snapToDevicePixel(px: number): number {
	const ratio = globalThis.devicePixelRatio || 1;
	return Math.round(px * ratio) / ratio;
}

export function floorToDevicePixel(px: number): number {
	const ratio = globalThis.devicePixelRatio || 1;
	return Math.floor(px * ratio + FLOAT_SLACK_DEVICE_PX) / ratio;
}

export function ceilToDevicePixel(px: number): number {
	const ratio = globalThis.devicePixelRatio || 1;
	return Math.ceil(px * ratio - FLOAT_SLACK_DEVICE_PX) / ratio;
}

export type ScrollGlideTarget = Pick<HTMLElement, 'scrollTop'>;

export type GlideState = {
	position: number;
	velocity: number;
};

export type ScrollGlide = {
	glide(element: ScrollGlideTarget, target: number): void;
	jump(element: ScrollGlideTarget, target: number): void;
	resync(element: ScrollGlideTarget): void;
	cancel(): void;
	readonly isGliding: boolean;
};

export function stepGlideSpring(
	state: GlideState,
	target: number,
	elapsedMs: number,
	stiffness: number = SCROLL_SPRING_STIFFNESS,
): GlideState {
	const settled = { position: target, velocity: 0 };
	if (![state.position, state.velocity, target, elapsedMs, stiffness].every(Number.isFinite)) {
		return settled;
	}
	if (stiffness <= 0 || elapsedMs >= OCCLUDED_FRAME_MS) return settled;
	if (elapsedMs <= 0) return state;
	elapsedMs = Math.min(elapsedMs, STALLED_FRAME_MS);

	const damping = 2 * Math.sqrt(stiffness);
	let { position, velocity } = state;
	let remainingMs = elapsedMs;
	while (remainingMs > 0) {
		const stepMs = Math.min(GLIDE_SAMPLE_MS, remainingMs);
		remainingMs -= stepMs;
		const stepSeconds = stepMs / 1000;
		const acceleration = -stiffness * (position - target) - damping * velocity;

		velocity += acceleration * stepSeconds;
		position += velocity * stepSeconds;
	}

	if (
		Math.abs(target - position) <= SCROLL_GLIDE_SETTLE_PX &&
		Math.abs(velocity) <= SCROLL_GLIDE_SETTLE_VELOCITY
	) {
		return settled;
	}
	return { position, velocity };
}

export function glideKeyframe(elapsedMs: number): number {
	return Math.max(0, Math.round(elapsedMs / GLIDE_KEYFRAME_MS));
}

export function glideOrigin(frameMs: number): number {
	return Math.floor(frameMs / GLIDE_SAMPLE_MS) * GLIDE_SAMPLE_MS;
}

export function glideSamples(state: GlideState, target: number, stiffness: number): GlideState[] {
	const samples = [state];
	for (let sample = state; sample.position !== target || sample.velocity !== 0;) {
		sample = stepGlideSpring(sample, target, GLIDE_SAMPLE_MS, stiffness);
		samples.push(sample);
	}
	return samples;
}

export function glideSampleAt(samples: readonly GlideState[], elapsedMs: number): GlideState {
	const index = Math.min(samples.length - 1, Math.max(0, Math.round(elapsedMs / GLIDE_SAMPLE_MS)));
	return samples[index] ?? { position: 0, velocity: 0 };
}

export function glideKeyframeCount(samples: readonly GlideState[]): number {
	return (samples.length - 1) * GLIDE_KEYFRAMES_PER_SAMPLE + 1;
}

export function glidePosition(samples: readonly GlideState[], keyframe: number): number {
	const last = samples.length - 1;
	const index = Math.min(last, Math.floor(keyframe / GLIDE_KEYFRAMES_PER_SAMPLE));
	const from = samples[index]?.position ?? 0;
	const to = samples[Math.min(last, index + 1)]?.position ?? from;
	const step = keyframe - index * GLIDE_KEYFRAMES_PER_SAMPLE;
	return from + ((to - from) * step) / GLIDE_KEYFRAMES_PER_SAMPLE;
}

type FrameScheduler = {
	requestFrame: (callback: (timestampMs: number) => void) => number;
	cancelFrame: (handle: number) => void;
};

type GlideOptions = Partial<FrameScheduler> & {
	stiffness?: number | (() => number);
	onSettle?: () => void;
};

function defaultScheduler(): FrameScheduler {
	return {
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (handle) => cancelAnimationFrame(handle),
	};
}

export function createScrollGlide(options: GlideOptions = {}): ScrollGlide {
	const fallback = defaultScheduler();
	const requestFrame = options.requestFrame ?? fallback.requestFrame;
	const cancelFrame = options.cancelFrame ?? fallback.cancelFrame;
	const stiffnessOption = options.stiffness ?? SCROLL_SPRING_STIFFNESS;
	const readStiffness = (): number =>
		typeof stiffnessOption === 'function' ? stiffnessOption() : stiffnessOption;
	const onSettle = options.onSettle;

	let element: ScrollGlideTarget | null = null;
	let target = 0;
	let frame: number | null = null;
	let originMs: number | null = null;
	let steppedAtMs: number | null = null;
	let stiffness = readStiffness();
	let samples: GlideState[] = [AT_TARGET];
	let shown = 0;

	function onTarget(sample: GlideState | undefined): GlideState {
		return { position: target + (sample?.position ?? 0), velocity: sample?.velocity ?? 0 };
	}

	function current(): GlideState {
		if (originMs === null || steppedAtMs === null) return onTarget(samples[0]);
		return onTarget(glideSampleAt(samples, glideOrigin(steppedAtMs) - originMs));
	}

	function replan(from: GlideState): void {
		stiffness = readStiffness();
		const offset = { position: from.position - target, velocity: from.velocity };
		samples = glideSamples(offset, 0, stiffness);
		originMs = steppedAtMs === null ? null : glideOrigin(steppedAtMs);
	}

	function stop(): void {
		if (frame !== null) cancelFrame(frame);
		frame = null;
		element = null;
		originMs = null;
		steppedAtMs = null;
	}

	function settle(node: ScrollGlideTarget): void {
		node.scrollTop = shown = target;
		samples = [AT_TARGET];
		stop();
		onSettle?.();
	}

	function step(timestampMs: number): void {
		frame = null;
		const node = element;
		if (!node) return;
		if (steppedAtMs !== null && timestampMs - steppedAtMs >= OCCLUDED_FRAME_MS) {
			settle(node);
			return;
		}
		if (originMs !== null && readStiffness() !== stiffness) {
			steppedAtMs = timestampMs;
			replan(current());
		}
		steppedAtMs = timestampMs;
		originMs ??= glideOrigin(timestampMs);
		const keyframe = glideKeyframe(timestampMs - originMs);
		if (keyframe >= glideKeyframeCount(samples) - 1) {
			settle(node);
			return;
		}
		node.scrollTop = shown = target + glidePosition(samples, keyframe);
		frame = requestFrame(step);
	}

	return {
		glide(node: ScrollGlideTarget, nextTarget: number): void {
			if (!Number.isFinite(nextTarget)) return;
			const inFlight = element === node && frame !== null;
			const now = inFlight ? current() : onTarget(samples[0]);
			const scrollTop = node.scrollTop;
			const from = {
				position: inFlight && unmoved(scrollTop, shown) ? now.position : scrollTop,
				velocity: now.velocity,
			};
			shown = scrollTop;
			target = nextTarget;
			if (
				Math.abs(from.position - target) <= SCROLL_GLIDE_SETTLE_PX &&
				Math.abs(from.velocity) <= SCROLL_GLIDE_SETTLE_VELOCITY
			) {
				node.scrollTop = shown = target;
				samples = [AT_TARGET];
				stop();
				return;
			}
			if (!inFlight) steppedAtMs = null;
			replan(from);
			if (inFlight) return;
			element = node;
			if (frame === null) frame = requestFrame(step);
		},
		resync(node: ScrollGlideTarget): void {
			const from = { position: node.scrollTop, velocity: current().velocity };
			shown = from.position;
			replan(from);
		},
		jump(node: ScrollGlideTarget, nextTarget: number): void {
			if (!Number.isFinite(nextTarget)) return;
			stop();
			node.scrollTop = shown = target = nextTarget;
			samples = [AT_TARGET];
		},
		cancel(): void {
			const at = current();
			stop();
			samples = [{ position: at.position - target, velocity: 0 }];
		},
		get isGliding(): boolean {
			return frame !== null;
		},
	};
}

function unmoved(scrollTop: number, shown: number): boolean {
	return Math.abs(scrollTop - shown) < DEVICE_PIXEL_SNAP_PX;
}
