import { arrivalMotion } from '../arrival-motion';
import { snapToDevicePixel, stepGlideSpring, type GlideState } from '../scroll-glide';
import type { TranscriptSettleGate } from './transcript-settle';

const MAX_TRACKED_STAGED_BLOCKS = 512;

const MAX_STAGED_PER_FRAME = 4;

const MAX_TRACKED_FLIGHTS = 64;

const DISCLOSURE_SETTLE_MS = 400;

const SETTLED_ROW = '[data-row-settled]';

const COVERED_FADE_PX = 12;

const COVER_FADE = 'data-cover-fade';

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
			shown: number;
			inFlow: boolean;
			glide: GlideState;
			translate: string;
			clip: string;
			fade: string;
		};
		const rows = new Map<HTMLElement, Row>();
		const fades = new Map<HTMLElement, HTMLElement>();
		let frame: number | null = null;
		let previousFrameMs: number | null = null;
		let width = container.clientWidth;
		let disclosedAtMs = Number.NEGATIVE_INFINITY;

		function trackDisclosure(event: Event): void {
			if (disclosureOf(event.target)) disclosedAtMs = performance.now();
		}

		function paint(): void {
			let below: number | null = null;
			for (let index = container.children.length - 1; index >= 0; index -= 1) {
				const element = container.children[index];
				const row = element instanceof HTMLElement ? rows.get(element) : undefined;
				if (!element || !row || !(element instanceof HTMLElement)) continue;
				const offset = row.glide.position;
				const covered = !row.inFlow || below === null ? 0 : Math.ceil(offset - below);
				const shown = Math.abs(offset) < 0.5 ? 0 : snapToDevicePixel(offset);
				const translate = shown === 0 ? '' : `0 ${shown}px`;
				const clip = covered < 1 ? '' : `inset(-100vh -100vw ${covered}px -100vw)`;
				const fade = covered < 1 ? '' : fadeTransform(row.bottom + shown - covered, covered);
				row.shown = shown;
				if (translate !== row.translate) {
					element.style.translate = row.translate = translate;
					element.style.willChange = translate === '' ? '' : 'translate';
				}
				if (clip !== row.clip) element.style.clipPath = row.clip = clip;
				if (fade !== row.fade) showFade(element, (row.fade = fade));
				if (row.inFlow) below = offset;
			}
		}

		function showFade(element: HTMLElement, transform: string): void {
			const fade = fades.get(element) ?? (transform === '' ? null : createFade(container));
			if (!fade) return;
			fades.set(element, fade);
			fade.hidden = transform === '';
			fade.style.transform = transform;
		}

		function dropFade(element: HTMLElement): void {
			fades.get(element)?.remove();
			fades.delete(element);
		}

		function step(nowMs: number): void {
			frame = null;
			const elapsedMs = previousFrameMs === null ? 0 : nowMs - previousFrameMs;
			previousFrameMs = nowMs;
			let moving = false;
			for (const row of rows.values()) {
				if (row.glide.position === 0 && row.glide.velocity === 0) continue;
				row.glide = stepGlideSpring(row.glide, 0, elapsedMs, arrivalMotion().glideStiffness);
				moving ||= row.glide.position !== 0 || row.glide.velocity !== 0;
			}
			paint();
			if (moving) frame = requestAnimationFrame(step);
			else previousFrameMs = null;
		}

		function measure(): void {
			const rewrapped = container.clientWidth !== width;
			width = container.clientWidth;
			const disclosing = performance.now() - disclosedAtMs < DISCLOSURE_SETTLE_MS;
			const animate =
				!rewrapped && !rebaseRequested && !opening() && !prefersReducedMotion() && !disclosing;
			rebaseRequested = false;
			const gone = new Set(rows.keys());
			const origin = container.getBoundingClientRect().top + container.clientTop;
			let moved = false;
			for (const element of container.children) {
				if (!(element instanceof HTMLElement) || element.hasAttribute('data-prompt-row')) continue;
				if (element.hasAttribute(COVER_FADE)) continue;
				gone.delete(element);
				const top = element.offsetTop;
				const row = rows.get(element);
				const bottom = element.getBoundingClientRect().bottom - origin - (row?.shown ?? 0);
				const inFlow = isInFlow(element);
				if (!row) {
					resizeObserver.observe(element);
					const glide = { position: 0, velocity: 0 };
					const settled = { translate: '', clip: '', fade: '' };
					rows.set(element, { top, bottom, shown: 0, inFlow, glide, ...settled });
					continue;
				}
				const shift = row.top - top;
				row.top = top;
				row.bottom = bottom;
				row.inFlow = inFlow;
				if (!inFlow) {
					moved ||= row.glide.position !== 0;
					row.glide = { position: 0, velocity: 0 };
				} else if (animate && Math.abs(shift) >= 0.5) {
					row.glide = { position: row.glide.position + shift, velocity: row.glide.velocity };
					moved = true;
				}
			}
			for (const element of gone) {
				resizeObserver.unobserve(element);
				rows.delete(element);
				dropFade(element);
			}
			if (!moved) return;
			paint();
			frame ??= requestAnimationFrame(step);
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
			if (frame !== null) cancelAnimationFrame(frame);
			for (const row of rows.values()) row.glide = { position: 0, velocity: 0 };
			paint();
			for (const element of fades.keys()) dropFade(element);
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

function fadeTransform(edge: number, covered: number): string {
	const height = Math.min(COVERED_FADE_PX, covered);
	return `translateY(${snapToDevicePixel(edge - height)}px) scaleY(${height / COVERED_FADE_PX})`;
}

function createFade(container: HTMLElement): HTMLElement {
	const fade = document.createElement('div');
	fade.setAttribute(COVER_FADE, '');
	fade.setAttribute('aria-hidden', 'true');
	Object.assign(fade.style, {
		position: 'absolute',
		top: '0',
		left: '0',
		right: '0',
		height: `${COVERED_FADE_PX}px`,
		pointerEvents: 'none',
		transformOrigin: '0 0',
		willChange: 'transform',
		background: 'linear-gradient(to bottom, transparent, var(--color-surface-root))',
	});
	container.append(fade);
	return fade;
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
