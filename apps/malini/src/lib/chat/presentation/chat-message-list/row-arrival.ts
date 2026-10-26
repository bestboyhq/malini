import { arrivalMotion } from '../arrival-motion';
import {
	GLIDE_KEYFRAMES_PER_SAMPLE,
	GLIDE_SAMPLE_MS,
	glideKeyframe,
	glideKeyframeCount,
	glideOrigin,
	glidePosition,
	glideSampleAt,
	glideSamples,
	snapToDevicePixel,
	type GlideState,
} from '../scroll-glide';
import type { TranscriptSettleGate } from './transcript-settle';

const MAX_TRACKED_STAGED_BLOCKS = 512;

const MAX_STAGED_PER_FRAME = 4;

const MAX_TRACKED_FLIGHTS = 64;

const DISCLOSURE_SETTLE_MS = 400;

const SETTLED_ROW = '[data-row-settled]';

const COVERED_FADE_PX = 12;

const COVER_FADE = 'data-cover-fade';

const FADE_BACKGROUND = 'linear-gradient(to bottom, transparent, var(--color-surface-root))';

const KEYFRAME_MS = GLIDE_SAMPLE_MS / GLIDE_KEYFRAMES_PER_SAMPLE;

const SETTLED: GlideState = { position: 0, velocity: 0 };

export type RowArrivalAction = (node: HTMLElement, key: string) => { destroy: () => void };

export type PromptArrivalAction = (
	node: HTMLElement,
	input: { key: string; resumeOnly?: boolean },
) => { destroy: () => void };

export type RowArrivals = {
	stageEnter: RowArrivalAction;
	promptArrival: PromptArrivalAction;
	glideRowLayout(container: HTMLElement): () => void;
	rebaseRowLayout(): void;
	destroy(): void;
};

export function createRowArrivals(input: {
	settle: TranscriptSettleGate;
	opening(): boolean;
	prefersReducedMotion(): boolean;
}): RowArrivals {
	const { settle, opening, prefersReducedMotion } = input;
	const stagedBlockKeys = new Set<string>();
	const arrivalFlights = new Map<string, number>();
	let stagedThisFrame = 0;
	let stageFrame: number | null = null;

	function playArrival(
		node: HTMLElement,
		elapsedMs: number,
		from: { transform: string; opacity: string },
		onDone: () => void,
	): void {
		if (prefersReducedMotion() || typeof node.animate !== 'function') {
			onDone();
			return;
		}
		const motion = arrivalMotion();
		const animation = node.animate(
			[
				{ transform: from.transform, opacity: from.opacity },
				{ transform: 'translateY(0)', opacity: '1' },
			],
			{ duration: motion.durationMs, easing: motion.easing, fill: 'none' },
		);
		animation.currentTime = elapsedMs;
		void (async () => {
			try {
				await animation.finished;
			} catch {}
			onDone();
		})();
	}

	function beginArrival(
		node: HTMLElement,
		key: string,
		from: { transform: string; opacity: string },
		resumeOnly = false,
	): void {
		const startedAtMs = arrivalFlights.get(key);
		if (resumeOnly && startedAtMs === undefined) return;
		const now = performance.now();
		const elapsedMs = startedAtMs === undefined ? 0 : now - startedAtMs;
		if (elapsedMs >= arrivalMotion().durationMs) {
			arrivalFlights.delete(key);
			return;
		}
		if (startedAtMs === undefined) {
			if (arrivalFlights.size >= MAX_TRACKED_FLIGHTS) {
				const oldest = arrivalFlights.keys().next().value;
				if (oldest !== undefined) arrivalFlights.delete(oldest);
			}
			arrivalFlights.set(key, now);
		}
		playArrival(node, elapsedMs, from, () => arrivalFlights.delete(key));
	}

	function rowArrivalFrom(): { transform: string; opacity: string } {
		return { transform: `translateY(${arrivalMotion().travelPx}px)`, opacity: '0' };
	}

	function stageEnter(node: HTMLElement, key: string): { destroy: () => void } {
		if (node.closest(SETTLED_ROW)) return { destroy: () => undefined };
		if (stagedBlockKeys.has(key)) {
			if (arrivalFlights.has(key)) beginArrival(node, key, rowArrivalFrom(), true);
			return { destroy: () => undefined };
		}
		if (stagedBlockKeys.size >= MAX_TRACKED_STAGED_BLOCKS) {
			const oldest = stagedBlockKeys.values().next().value;
			if (oldest !== undefined) stagedBlockKeys.delete(oldest);
		}
		stagedBlockKeys.add(key);
		const transcriptSettled = settle.isSettled();
		if (transcriptSettled && stagedThisFrame < MAX_STAGED_PER_FRAME) {
			stagedThisFrame += 1;
			if (stageFrame === null) {
				stageFrame = requestAnimationFrame(() => {
					stageFrame = null;
					stagedThisFrame = 0;
				});
			}
			beginArrival(node, key, rowArrivalFrom());
		}
		return { destroy: () => undefined };
	}

	function promptArrival(
		node: HTMLElement,
		input: { key: string; resumeOnly?: boolean },
	): { destroy: () => void } {
		beginArrival(
			node,
			`prompt:${input.key}`,
			{
				transform: `translateY(calc(100% + ${arrivalMotion().promptOffsetPx}px))`,
				opacity: '1',
			},
			input.resumeOnly ?? false,
		);
		return { destroy: () => undefined };
	}

	let rebaseRequested = false;

	function glideRowLayout(container: HTMLElement): () => void {
		type Row = {
			top: number;
			bottom: number;
			inFlow: boolean;
			startMs: number;
			samples: GlideState[];
			positions: number[];
			animation: Animation | null;
		};
		type Cover = { lower: HTMLElement; fade: HTMLElement; block: HTMLElement };
		const rows = new Map<HTMLElement, Row>();
		const covers = new Map<HTMLElement, Cover>();
		let unstarted: Animation[] = [];
		let startFrame: number | null = null;
		let width = container.clientWidth;
		let disclosedAtMs = Number.NEGATIVE_INFINITY;

		function trackDisclosure(event: Event): void {
			if (disclosureOf(event.target)) disclosedAtMs = performance.now();
		}

		function stateAt(row: Row, originMs: number): GlideState {
			return glideSampleAt(row.samples, originMs - Number(row.animation?.startTime ?? row.startMs));
		}

		function shownNow(row: Row): number {
			const animation = row.animation;
			if (animation?.playState !== 'running') return 0;
			const index = shownSample(Number(animation.currentTime ?? 0), row.positions.length);
			return shownOffset(row.positions[index] ?? 0);
		}

		function gliding(row: Row): boolean {
			return row.animation?.playState === 'running';
		}

		function begin(animation: Animation, originMs: number | null): Animation {
			if (originMs !== null) {
				animation.startTime = originMs;
				return animation;
			}
			unstarted.push(animation);
			startFrame ??= requestAnimationFrame((frameMs) => {
				startFrame = null;
				for (const pending of unstarted) {
					if (pending.playState !== 'idle') pending.startTime = glideOrigin(frameMs);
				}
				unstarted = [];
			});
			return animation;
		}

		function play(element: HTMLElement, row: Row, originMs: number | null): void {
			row.animation?.cancel();
			row.animation = null;
			if (row.positions.length < 2) return;
			const offsets = row.positions.map((position) => `0 ${shownOffset(position)}px`);
			row.animation = begin(animateFrames(element, 'translate', offsets), originMs);
		}

		function removeCover(upper: HTMLElement): void {
			const cover = covers.get(upper);
			if (!cover) return;
			covers.delete(upper);
			for (const part of [cover.fade, cover.block]) {
				for (const animation of part.getAnimations()) animation.cancel();
				part.remove();
			}
			cover.lower.style.isolation = '';
		}

		function coverFrames(upper: Row, below: Row): { fade: string[]; block: string[] } | null {
			const offsetAt = (row: Row, index: number): number => row.positions[index] ?? 0;
			const length = Math.max(upper.positions.length, below.positions.length);
			const depths = Array.from({ length }, (_, index) =>
				Math.ceil(offsetAt(upper, index) - offsetAt(below, index)),
			);
			let lastCovered = depths.length - 1;
			while (lastCovered >= 0 && (depths[lastCovered] ?? 0) < 1) lastCovered -= 1;
			if (lastCovered < 0) return null;
			const steps = depths.slice(0, lastCovered + 2).map((depth) => (depth < 1 ? 0 : depth));
			const edges = steps.map(
				(depth, index) => upper.bottom + shownOffset(offsetAt(upper, index)) - depth,
			);
			return {
				fade: steps.map((depth, index) => {
					const height = Math.min(COVERED_FADE_PX, depth);
					const top = snapToDevicePixel((edges[index] ?? 0) - height);
					return `translateY(${top}px) scaleY(${height / COVERED_FADE_PX})`;
				}),
				block: steps.map((depth, index) => `translateY(${edges[index] ?? 0}px) scaleY(${depth})`),
			};
		}

		function cover(
			upperElement: HTMLElement,
			upper: Row,
			lower: HTMLElement,
			below: Row,
			originMs: number | null,
		): boolean {
			const frames = coverFrames(upper, below);
			if (!frames) return false;
			if (covers.get(upperElement)?.lower !== lower) removeCover(upperElement);
			const entry = covers.get(upperElement) ?? {
				lower,
				fade: coverPart('fade', COVERED_FADE_PX),
				block: coverPart('block', 1),
			};
			if (!covers.has(upperElement)) {
				covers.set(upperElement, entry);
				lower.style.isolation = 'isolate';
			}
			if (
				upperElement.nextElementSibling !== entry.fade ||
				entry.fade.nextElementSibling !== entry.block
			) {
				upperElement.after(entry.fade, entry.block);
			}
			for (const part of [entry.fade, entry.block]) {
				for (const animation of part.getAnimations()) animation.cancel();
			}
			begin(animateFrames(entry.fade, 'transform', frames.fade), originMs);
			const blockAnimation = begin(animateFrames(entry.block, 'transform', frames.block), originMs);
			blockAnimation.onfinish = () => {
				if (covers.get(upperElement) === entry) removeCover(upperElement);
			};
			return true;
		}

		function replan(shifts: Map<Row, number>, resets: Set<Row>, inFlight: boolean): void {
			const nowMs = performance.now();
			const originMs = inFlight
				? glideOrigin(Number(document.timeline.currentTime ?? nowMs))
				: null;
			for (const [element, row] of rows) {
				const current = resets.has(row) ? SETTLED : stateAt(row, originMs ?? glideOrigin(nowMs));
				const shift = shifts.get(row) ?? 0;
				const state = { position: current.position + shift, velocity: current.velocity };
				row.samples = glideSamples(state, 0, arrivalMotion().glideStiffness);
				row.positions = keyframePositions(row.samples);
				row.startMs = originMs ?? nowMs;
				play(element, row, originMs);
			}
			const covered = new Set<HTMLElement>();
			let lower: HTMLElement | null = null;
			for (let index = container.children.length - 1; index >= 0; index -= 1) {
				const element = container.children[index];
				const row = element instanceof HTMLElement ? rows.get(element) : undefined;
				if (!(element instanceof HTMLElement) || !row?.inFlow) continue;
				const below = lower ? rows.get(lower) : undefined;
				if (lower && below && cover(element, row, lower, below, originMs)) covered.add(element);
				lower = element;
			}
			for (const upper of [...covers.keys()]) if (!covered.has(upper)) removeCover(upper);
		}

		function measure(): void {
			const nowMs = performance.now();
			const rewrapped = container.clientWidth !== width;
			width = container.clientWidth;
			const disclosing = nowMs - disclosedAtMs < DISCLOSURE_SETTLE_MS;
			const animate =
				!rewrapped && !rebaseRequested && !opening() && !prefersReducedMotion() && !disclosing;
			rebaseRequested = false;
			const gone = new Set(rows.keys());
			const origin = container.getBoundingClientRect().top + container.clientTop;
			const shifts = new Map<Row, number>();
			const resets = new Set<Row>();
			let changed = false;
			for (const element of container.children) {
				if (!(element instanceof HTMLElement) || element.hasAttribute('data-prompt-row')) continue;
				if (element.hasAttribute(COVER_FADE)) continue;
				gone.delete(element);
				const top = element.offsetTop;
				const row = rows.get(element);
				const bottom = element.getBoundingClientRect().bottom - origin - (row ? shownNow(row) : 0);
				const inFlow = isInFlow(element);
				if (!row) {
					resizeObserver.observe(element);
					rows.set(element, {
						top,
						bottom,
						inFlow,
						startMs: nowMs,
						samples: [SETTLED],
						positions: [0],
						animation: null,
					});
					changed = true;
					continue;
				}
				const shift = row.top - top;
				changed ||=
					Math.abs(shift) >= 0.5 || Math.abs(row.bottom - bottom) >= 0.5 || row.inFlow !== inFlow;
				row.top = top;
				row.bottom = bottom;
				row.inFlow = inFlow;
				if (!inFlow && gliding(row)) resets.add(row);
				else if (inFlow && animate && Math.abs(shift) >= 0.5) shifts.set(row, shift);
			}
			for (const element of gone) {
				resizeObserver.unobserve(element);
				rows.get(element)?.animation?.cancel();
				rows.delete(element);
				changed = true;
			}
			const inFlight = [...rows.values()].some(gliding);
			if (shifts.size > 0 || resets.size > 0 || (changed && inFlight)) {
				replan(shifts, resets, inFlight);
			}
		}

		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(container);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(container, { childList: true, subtree: true });
		container.addEventListener('click', trackDisclosure, true);
		container.addEventListener('toggle', trackDisclosure, true);
		return () => {
			container.removeEventListener('click', trackDisclosure, true);
			container.removeEventListener('toggle', trackDisclosure, true);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			if (startFrame !== null) cancelAnimationFrame(startFrame);
			for (const row of rows.values()) row.animation?.cancel();
			for (const upper of [...covers.keys()]) removeCover(upper);
			rows.clear();
		};
	}

	return {
		stageEnter,
		promptArrival,
		glideRowLayout,
		rebaseRowLayout: () => {
			rebaseRequested = true;
		},
		destroy(): void {
			if (stageFrame !== null) cancelAnimationFrame(stageFrame);
			stageFrame = null;
			arrivalFlights.clear();
		},
	};
}

function keyframePositions(samples: readonly GlideState[]): number[] {
	return Array.from({ length: glideKeyframeCount(samples) }, (_, keyframe) =>
		glidePosition(samples, keyframe),
	);
}

function shownOffset(position: number): number {
	return Math.abs(position) < 0.5 ? 0 : snapToDevicePixel(position);
}

function shownSample(elapsedMs: number, count: number): number {
	return Math.min(count - 1, glideKeyframe(elapsedMs));
}

function animateFrames(
	element: HTMLElement,
	property: 'translate' | 'transform',
	frames: readonly string[],
): Animation {
	const span = frames.length - 1.5;
	const keyframes = frames.flatMap((value, index) =>
		index > 0 && index < frames.length - 1 && value === frames[index - 1]
			? []
			: [{ [property]: value, offset: index === 0 ? 0 : (index - 0.5) / span, easing: 'step-end' }],
	);
	return element.animate(keyframes, { duration: span * KEYFRAME_MS, fill: 'backwards' });
}

function coverPart(kind: 'fade' | 'block', height: number): HTMLElement {
	const part = document.createElement('div');
	part.setAttribute(COVER_FADE, kind);
	part.setAttribute('aria-hidden', 'true');
	Object.assign(part.style, {
		position: 'absolute',
		top: '0',
		left: '0',
		right: '0',
		height: `${height}px`,
		pointerEvents: 'none',
		transformOrigin: '0 0',
		transform: 'scaleY(0)',
		background: kind === 'fade' ? FADE_BACKGROUND : 'var(--color-surface-root)',
	});
	return part;
}

function disclosureOf(target: EventTarget | null): HTMLElement | null {
	if (target instanceof HTMLDetailsElement) return target;
	const control = target instanceof Element ? target.closest('summary, [aria-expanded]') : null;
	return control?.parentElement ?? null;
}

function isInFlow(element: HTMLElement): boolean {
	return (
		element.hasAttribute('data-transcript-row') || getComputedStyle(element).position !== 'absolute'
	);
}
