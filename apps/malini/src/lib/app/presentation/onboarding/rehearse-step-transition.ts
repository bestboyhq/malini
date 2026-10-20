import { linear } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export type StepTransition = Readonly<{ inbound: TransitionConfig; outbound: TransitionConfig }>;

export type Rehearsal = Readonly<{
	again: () => void;
	interrupt: () => void;
	ready: () => boolean;
}>;

const HIDDEN_OPACITY = 0.004;
const SWEEP_PROGRESS = [0, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.375, 0.5, 0.75, 1];
const SUBPIXEL_SHIFTS = ['0.3px', '0.6px', '0.9px'];
const EXACT_PX = '256px';
const DRIFT: Keyframe[] = [
	{ translate: '0px', opacity: HIDDEN_OPACITY / 2 },
	{ translate: '7.3px', opacity: HIDDEN_OPACITY },
];
const DRIFT_MS = 300;
const KEYFRAMES = 18;
const MIN_FRAMES = 8;
const SETTLED_FRAMES = 5;
const SLOW_FRAME_MS = 20;
const STALL_MS = 50;
const GIVE_UP_MS = 4000;
const ROUNDS = 3;

// ponytail: Chromium compiles a GPU pipeline the first time it draws each blur kernel, sampling and edge mode, which stalls a blurred transition on a fresh install; this plays the step transition on invisible copies of the step, between sweeps through the blur radii, and reports ready once a play runs without a stall. The set is Chromium's to change, so re-measure a cold start after an Electron bump.
export function rehearseStepTransition(
	currentStep: () => Element | null,
	transition: StepTransition,
): Rehearsal {
	const copies = new Set<HTMLElement>();
	let generation = 0;
	let queued = false;
	let running = false;
	let ready = false;

	const clear = (): void => {
		for (const copy of copies) {
			for (const animation of copy.getAnimations()) animation.cancel();
			copy.remove();
		}
		copies.clear();
	};

	const play = async (step: HTMLElement, live: () => boolean): Promise<boolean> => {
		const leaving = copyOf(step, copies);
		const arriving = copyOf(step, copies);
		const exact = copyOf(step, copies);
		Object.assign(exact.style, { width: EXACT_PX, height: EXACT_PX, overflow: 'hidden' });
		await nextFrame();
		if (!live()) return false;
		const played = [
			leaving.animate(...animationOf(transition.outbound, 'out')),
			arriving.animate(...animationOf(transition.inbound, 'in')),
			exact.animate(...animationOf(transition.inbound, 'in')),
		];
		const smooth = await ranWithoutStall(
			Promise.all(played.map((animation) => animation.finished)),
		);
		clear();
		return smooth && live();
	};

	const sweep = async (step: HTMLElement, live: () => boolean): Promise<void> => {
		for (const [index, u] of SWEEP_PROGRESS.entries()) {
			const filter = String(keyframeAt(transition.inbound, 1 - u, u)['filter'] ?? '');
			const still = copyOf(step, copies);
			Object.assign(still.style, {
				filter,
				translate: SUBPIXEL_SHIFTS[index % SUBPIXEL_SHIFTS.length],
			});
			const moving = copyOf(step, copies);
			moving.style.filter = filter;
			moving.animate(DRIFT, { duration: DRIFT_MS, iterations: Infinity });
		}
		await settle(live);
		clear();
	};

	const run = async (): Promise<void> => {
		running = true;
		while (queued) {
			queued = false;
			const pass = generation;
			const live = (): boolean => pass === generation;
			do await nextFrame();
			while (live() && somethingMoves());
			const step = currentStep();
			if (!(step instanceof HTMLElement)) continue;
			for (let round = 0; round < ROUNDS && live(); round += 1) {
				if (await play(step, live)) {
					ready = true;
					break;
				}
				if (live()) await sweep(step, live);
			}
		}
		running = false;
	};

	return {
		again: () => {
			queued = true;
			if (!running) void run();
		},
		interrupt: () => {
			generation += 1;
			queued = false;
			ready = false;
			clear();
		},
		ready: () => ready,
	};
}

function animationOf(
	config: TransitionConfig,
	way: 'in' | 'out',
): [Keyframe[], KeyframeAnimationOptions] {
	const easing = config.easing ?? linear;
	const keyframes = Array.from({ length: KEYFRAMES + 1 }, (_, index) => {
		const eased = easing(index / KEYFRAMES);
		const t = way === 'in' ? eased : 1 - eased;
		return keyframeAt(config, t, 1 - t);
	});
	return [keyframes, { duration: config.duration ?? 0, delay: config.delay ?? 0, fill: 'both' }];
}

function keyframeAt(config: TransitionConfig, t: number, u: number): Keyframe {
	const declarations = (config.css?.(t, u) ?? '')
		.split(';')
		.map((declaration) => declaration.split(':').map((part) => part.trim()))
		.filter(([property, value]) => property && value);
	const keyframe: Keyframe = Object.fromEntries(declarations);
	return { ...keyframe, opacity: Number(keyframe['opacity'] ?? 1) * HIDDEN_OPACITY };
}

function copyOf(step: HTMLElement, copies: Set<HTMLElement>): HTMLElement {
	const copy = document.createElement(step.tagName);
	copy.className = step.className;
	copy.append(...Array.from(step.childNodes, (node) => node.cloneNode(true)));
	for (const named of copy.querySelectorAll('[id], [data-testid]')) {
		named.removeAttribute('id');
		named.removeAttribute('data-testid');
	}
	copy.setAttribute('inert', '');
	copy.setAttribute('aria-hidden', 'true');
	Object.assign(copy.style, {
		position: 'absolute',
		inset: '0 0 auto',
		pointerEvents: 'none',
		opacity: String(HIDDEN_OPACITY),
	});
	step.parentElement?.append(copy);
	for (const animation of copy.getAnimations({ subtree: true })) animation.cancel();
	copies.add(copy);
	return copy;
}

async function ranWithoutStall(finished: Promise<unknown>): Promise<boolean> {
	let done = false;
	void (async () => {
		await finished.catch(() => undefined);
		done = true;
	})();
	let last = performance.now();
	let smooth = true;
	while (!done) {
		await nextFrame();
		const now = performance.now();
		if (now - last >= STALL_MS) smooth = false;
		last = now;
	}
	return smooth;
}

async function settle(live: () => boolean): Promise<void> {
	const start = performance.now();
	let last = start;
	let frames = 0;
	let calm = 0;
	while (live() && (frames < MIN_FRAMES || calm < SETTLED_FRAMES) && last - start < GIVE_UP_MS) {
		await nextFrame();
		const now = performance.now();
		frames += 1;
		calm = now - last < SLOW_FRAME_MS ? calm + 1 : 0;
		last = now;
	}
}

function somethingMoves(): boolean {
	return document
		.getAnimations()
		.some(
			(animation) =>
				animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity,
		);
}

function nextFrame(): Promise<number> {
	return new Promise((resolve) => requestAnimationFrame(resolve));
}
