export const SCROLL_SPRING_STIFFNESS = 420;

export const SCROLL_GLIDE_SETTLE_PX = 0.5;

export const SCROLL_GLIDE_SETTLE_VELOCITY = 8;

const MAX_SUBSTEP_MS = 1000 / 240;

const OCCLUDED_FRAME_MS = 1000;

const STALLED_FRAME_MS = 34;

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
		const stepMs = Math.min(MAX_SUBSTEP_MS, remainingMs);
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
	let previousTimestampMs: number | null = null;

	let state: GlideState = { position: 0, velocity: 0 };

	function stop(): void {
		if (frame !== null) cancelFrame(frame);
		frame = null;
		element = null;
		previousTimestampMs = null;
	}

	function step(timestampMs: number): void {
		frame = null;
		const node = element;
		if (!node) return;
		const elapsedMs = previousTimestampMs === null ? 0 : timestampMs - previousTimestampMs;
		previousTimestampMs = timestampMs;

		if (elapsedMs <= 0) {
			frame = requestFrame(step);
			return;
		}
		state = stepGlideSpring(state, target, elapsedMs, readStiffness());
		node.scrollTop = state.position;
		if (state.position === target && state.velocity === 0) {
			stop();
			onSettle?.();
			return;
		}
		frame = requestFrame(step);
	}

	return {
		glide(node: ScrollGlideTarget, nextTarget: number): void {
			if (!Number.isFinite(nextTarget)) return;
			target = nextTarget;

			state = { position: node.scrollTop, velocity: state.velocity };
			if (
				Math.abs(state.position - target) <= SCROLL_GLIDE_SETTLE_PX &&
				Math.abs(state.velocity) <= SCROLL_GLIDE_SETTLE_VELOCITY
			) {
				node.scrollTop = target;
				state = { position: target, velocity: 0 };
				stop();
				return;
			}

			if (element === node && frame !== null) return;
			element = node;
			previousTimestampMs = null;
			if (frame === null) frame = requestFrame(step);
		},
		resync(node: ScrollGlideTarget): void {
			state = { position: node.scrollTop, velocity: state.velocity };
		},
		jump(node: ScrollGlideTarget, nextTarget: number): void {
			if (!Number.isFinite(nextTarget)) return;
			stop();
			node.scrollTop = nextTarget;
			state = { position: nextTarget, velocity: 0 };
		},
		cancel(): void {
			stop();
			state = { position: state.position, velocity: 0 };
		},
		get isGliding(): boolean {
			return frame !== null;
		},
	};
}
