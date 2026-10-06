import { arrivalMotion } from '../arrival-motion';
import { stepGlideSpring, type GlideState } from '../scroll-glide';
import type { TranscriptSettleGate } from './transcript-settle';

const MAX_TRACKED_STAGED_BLOCKS = 512;

const MAX_STAGED_PER_FRAME = 4;

const MAX_TRACKED_FLIGHTS = 64;

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
	prefersReducedMotion(): boolean;
}): RowArrivals {
	const { settle, prefersReducedMotion } = input;
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
			element: HTMLElement;
			top: number;
			inFlow: boolean;
			glide: GlideState;
			translate: string;
			clip: string;
		};
		let rows: Row[] = [];
		let frame: number | null = null;
		let previousFrameMs: number | null = null;

		function paint(): void {
			let nextOffset: number | null = null;
			for (let index = rows.length - 1; index >= 0; index -= 1) {
				const row = rows[index];
				if (!row) continue;
				const offset = row.glide.position;
				const overlap = row.inFlow && nextOffset !== null ? offset - nextOffset : 0;
				const translate = Math.abs(offset) < 0.5 ? '' : `0 ${offset}px`;
				const clip = overlap < 0.5 ? '' : `inset(-1rem -1rem ${Math.ceil(overlap)}px -1rem)`;
				if (translate !== row.translate) row.element.style.translate = row.translate = translate;
				if (clip !== row.clip) row.element.style.clipPath = row.clip = clip;
				if (row.inFlow) nextOffset = offset;
			}
		}

		function step(nowMs: number): void {
			frame = null;
			const elapsedMs = previousFrameMs === null ? 0 : nowMs - previousFrameMs;
			previousFrameMs = nowMs;
			let moving = false;
			for (const row of rows) {
				if (row.glide.position === 0 && row.glide.velocity === 0) continue;
				row.glide = stepGlideSpring(row.glide, 0, elapsedMs, arrivalMotion().layoutStiffness);
				moving ||= row.glide.position !== 0 || row.glide.velocity !== 0;
			}
			paint();
			if (moving) frame = requestAnimationFrame(step);
			else previousFrameMs = null;
		}

		function measure(): void {
			const animate = !rebaseRequested && !prefersReducedMotion();
			rebaseRequested = false;
			const known = new Map(rows.map((row) => [row.element, row]));
			let moved = false;
			rows = [...container.children].flatMap((element): Row[] => {
				if (!(element instanceof HTMLElement) || element.hasAttribute('data-prompt-row')) return [];
				const top = element.offsetTop;
				const inFlow = getComputedStyle(element).position !== 'absolute';
				const row = known.get(element);
				known.delete(element);
				if (!row) {
					resizeObserver.observe(element);
					const glide = { position: 0, velocity: 0 };
					return [{ element, top, inFlow, glide, translate: '', clip: '' }];
				}
				const shift = row.top - top;
				row.top = top;
				row.inFlow = inFlow;
				if (animate && Math.abs(shift) >= 0.5) {
					row.glide = { position: row.glide.position + shift, velocity: row.glide.velocity };
					moved = true;
				}
				return [row];
			});
			for (const element of known.keys()) resizeObserver.unobserve(element);
			if (!moved) return;
			paint();
			if (frame === null) frame = requestAnimationFrame(step);
		}

		const resizeObserver = new ResizeObserver(measure);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(container, { childList: true });
		measure();
		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			if (frame !== null) cancelAnimationFrame(frame);
			for (const row of rows) row.glide = { position: 0, velocity: 0 };
			paint();
			rows = [];
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
