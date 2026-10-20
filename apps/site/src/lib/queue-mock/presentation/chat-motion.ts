import type { Attachment } from 'svelte/attachments';

const ARRIVAL_MS = 240;
const ARRIVAL_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const ROW_TRAVEL_PX = 8;
const PROMPT_OFFSET_PX = 34;
const STIFFNESS = 420;
const SETTLE_PX = 0.5;
const SETTLE_VELOCITY = 8;
const MAX_SUBSTEP_MS = 1000 / 240;
const OCCLUDED_FRAME_MS = 1000;
const STALLED_FRAME_MS = 34;
const EMERGE_FADE_PX = 24;
const LINE_REVEAL_MS = 220;
const LINE_SLACK_PX = 6;
const TOKEN_STAGGER_MS = 4;
const MAX_STAGGER_ORDER = 6;
const EMERGE_MASK_BOX: ReadonlyArray<readonly [string, string]> = [
	['mask-position', '-1rem -1rem'],
	['mask-size', 'calc(100% + 2rem) calc(100% + 1rem)'],
	['mask-repeat', 'no-repeat'],
	['mask-clip', 'no-clip'],
];

type Glide = { position: number; velocity: number };

export function reducedMotion(): boolean {
	return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function snap(px: number): number {
	const ratio = devicePixelRatio || 1;
	return Math.round(px * ratio) / ratio;
}

function stepSpring(state: Glide, target: number, elapsedMs: number): Glide {
	if (elapsedMs >= OCCLUDED_FRAME_MS) return { position: target, velocity: 0 };
	if (elapsedMs <= 0) return state;
	const damping = 2 * Math.sqrt(STIFFNESS);
	let { position, velocity } = state;
	let remainingMs = Math.min(elapsedMs, STALLED_FRAME_MS);
	while (remainingMs > 0) {
		const stepSeconds = Math.min(MAX_SUBSTEP_MS, remainingMs) / 1000;
		remainingMs -= MAX_SUBSTEP_MS;
		velocity += (-STIFFNESS * (position - target) - damping * velocity) * stepSeconds;
		position += velocity * stepSeconds;
	}
	const still = Math.abs(target - position) <= SETTLE_PX && Math.abs(velocity) <= SETTLE_VELOCITY;
	return still ? { position: target, velocity: 0 } : { position, velocity };
}

function frames(tick: (elapsedMs: number) => boolean): () => void {
	let previous: number | null = null;
	let frame = 0;
	const run = (now: number): void => {
		const elapsed = previous === null ? 0 : now - previous;
		previous = now;
		if (tick(elapsed)) frame = requestAnimationFrame(run);
	};
	frame = requestAnimationFrame(run);
	return () => cancelAnimationFrame(frame);
}

function revealLines(node: HTMLElement): void {
	let line = -1;
	let lineTop = -Infinity;
	let order = 0;
	for (const token of node.querySelectorAll<HTMLElement>('.stream-token')) {
		if (token.offsetTop > lineTop + LINE_SLACK_PX) {
			line += 1;
			lineTop = token.offsetTop;
			order = 0;
		}
		const stagger = Math.min(order, MAX_STAGGER_ORDER) * TOKEN_STAGGER_MS;
		token.style.animationDelay = `${line * LINE_REVEAL_MS + stagger}ms`;
		order += 1;
	}
}

function arrive(node: HTMLElement, transform: string, opacity: string): void {
	if (reducedMotion()) return;
	node.animate(
		[
			{ transform, opacity },
			{ transform: 'translateY(0)', opacity: '1' },
		],
		{ duration: ARRIVAL_MS, easing: ARRIVAL_EASING },
	);
}

export class Arrivals {
	#staged = new Set<string>();
	#live = false;

	get live(): boolean {
		return this.#live;
	}

	settle(): void {
		this.#live = true;
	}

	reset(): void {
		this.#staged.clear();
		this.#live = false;
	}

	row(key: string, latest = true): Attachment<HTMLElement> {
		return (node) => {
			if (this.#staged.has(key)) return;
			this.#staged.add(key);
			if (!latest || !this.#live) return;
			node.dataset['stream'] = '';
			revealLines(node);
			arrive(node, `translateY(${ROW_TRAVEL_PX}px)`, '0');
		};
	}

	prompt(key: string): Attachment<HTMLElement> {
		return (node) => {
			if (this.#staged.has(key)) return;
			this.#staged.add(key);
			if (this.#live) arrive(node, `translateY(calc(100% + ${PROMPT_OFFSET_PX}px))`, '1');
		};
	}
}

export function glideRows(live: () => boolean): Attachment<HTMLElement> {
	return (container) => {
		type Row = {
			element: HTMLElement;
			top: number;
			inFlow: boolean;
			glide: Glide;
			translate: string;
			mask: string;
		};
		let rows: Row[] = [];
		let stop: (() => void) | null = null;
		let width = container.clientWidth;

		function paint(): void {
			let below: number | null = null;
			for (let index = rows.length - 1; index >= 0; index -= 1) {
				const row = rows[index];
				if (!row) continue;
				const offset = row.glide.position;
				const overlap = row.inFlow && below !== null ? offset - below : 0;
				const translate = Math.abs(offset) < 0.5 ? '' : `0 ${snap(offset)}px`;
				const mask = overlap < 0.5 ? '' : emergeAbove(overlap);
				if (translate !== row.translate) row.element.style.translate = row.translate = translate;
				if (mask !== row.mask) {
					row.mask = mask;
					row.element.style.setProperty('mask-image', mask);
					for (const [property, value] of EMERGE_MASK_BOX) {
						row.element.style.setProperty(property, mask && value);
					}
				}
				if (row.inFlow) below = offset;
			}
		}

		function animate(): void {
			stop ??= frames((elapsed) => {
				let moving = false;
				for (const row of rows) {
					if (row.glide.position === 0 && row.glide.velocity === 0) continue;
					row.glide = stepSpring(row.glide, 0, elapsed);
					moving ||= row.glide.position !== 0 || row.glide.velocity !== 0;
				}
				paint();
				if (!moving) stop = null;
				return moving;
			});
		}

		function measure(): void {
			const rewrapped = container.clientWidth !== width;
			width = container.clientWidth;
			const glides = !rewrapped && live() && !reducedMotion();
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
					return [
						{ element, top, inFlow, glide: { position: 0, velocity: 0 }, translate: '', mask: '' },
					];
				}
				const shift = row.top - top;
				row.top = top;
				row.inFlow = inFlow;
				if (glides && Math.abs(shift) >= 0.5) {
					row.glide = { position: row.glide.position + shift, velocity: row.glide.velocity };
					moved = true;
				}
				return [row];
			});
			for (const element of known.keys()) resizeObserver.unobserve(element);
			if (!moved) return;
			paint();
			animate();
		}

		const resizeObserver = new ResizeObserver(measure);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(container, { childList: true, subtree: true });
		measure();
		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			stop?.();
			for (const row of rows) row.glide = { position: 0, velocity: 0 };
			paint();
		};
	};
}

function emergeAbove(overlapPx: number): string {
	const hidden = Math.ceil(overlapPx);
	const shown = hidden + Math.min(EMERGE_FADE_PX, hidden);
	return `linear-gradient(to top, transparent ${hidden}px, black ${shown}px)`;
}

export class TranscriptFollow {
	live = false;
	#viewport: HTMLElement | null = null;
	#list: HTMLElement | null = null;
	#hold = 0;
	#covered = 0;
	#shown = 0;
	#space = 0;
	#overlay = 0;
	#glide: Glide = { position: 0, velocity: 0 };
	#target = 0;
	#stop: (() => void) | null = null;

	observe(list: HTMLElement): Attachment<HTMLElement> {
		return (viewport) => {
			this.#viewport = viewport;
			this.#list = list;
			const reveal = (): void => {
				this.#covered = 0;
				this.#reconcile(true);
			};
			const resizeObserver = new ResizeObserver(reveal);
			resizeObserver.observe(list);
			const mutationObserver = new MutationObserver(reveal);
			mutationObserver.observe(list, { childList: true, subtree: true });
			this.jump();
			return () => {
				resizeObserver.disconnect();
				mutationObserver.disconnect();
				this.#cancel();
			};
		};
	}

	spaceBelow(px: number, overlayPx: number): void {
		const covered = this.live ? Math.max(0, this.#covered + overlayPx - this.#overlay) : 0;
		const moved = px - this.#space - (covered - this.#covered);
		this.#space = px;
		this.#overlay = overlayPx;
		this.#covered = covered;
		if (!this.#glides()) {
			this.#reconcile(false);
			return;
		}
		this.#scrollTo(this.#shown + moved);
		this.#reconcile(true);
	}

	jump(): void {
		this.#covered = 0;
		this.#cancel();
		this.#setHold(0);
		this.#reconcile(false);
	}

	#glides(): boolean {
		return this.live && !reducedMotion();
	}

	#naturalMax(viewport: HTMLElement): number {
		return Math.max(0, viewport.scrollHeight - this.#hold - viewport.clientHeight);
	}

	#setHold(px: number): void {
		const next = Math.max(0, Math.round(px));
		if (next === this.#hold) return;
		this.#hold = next;
		this.#list?.style.setProperty('--chat-hold-space', `${next}px`);
	}

	#scrollTo(value: number): void {
		this.#shown = value;
		if (this.#viewport) this.#viewport.scrollTop = value;
	}

	#cancel(): void {
		this.#stop?.();
		this.#stop = null;
		this.#glide = { position: this.#glide.position, velocity: 0 };
	}

	#reconcile(animate: boolean): void {
		const viewport = this.#viewport;
		if (!viewport) return;
		const top = viewport.scrollTop;
		const clamped = top < this.#shown && top >= viewport.scrollHeight - viewport.clientHeight - 1;
		if (!clamped) this.#shown = top;
		const target = this.#naturalMax(viewport) - this.#covered;
		const glides = animate && this.#glides();
		const reach =
			glides && (this.#stop !== null || clamped) ? Math.max(target, this.#shown) : target;
		this.#setHold(reach - this.#naturalMax(viewport));
		if (!glides) {
			this.#cancel();
			this.#scrollTo(target);
			return;
		}
		if (clamped) this.#scrollTo(this.#shown);
		this.#glideTo(viewport, target);
	}

	#glideTo(viewport: HTMLElement, target: number): void {
		this.#target = target;
		const shown = viewport.scrollTop;
		const position =
			this.#stop && Math.abs(shown - this.#glide.position) < 1 ? this.#glide.position : shown;
		this.#glide = { position, velocity: this.#glide.velocity };
		if (
			Math.abs(position - target) <= SETTLE_PX &&
			Math.abs(this.#glide.velocity) <= SETTLE_VELOCITY
		) {
			this.#cancel();
			this.#scrollTo(target);
			return;
		}
		this.#stop ??= frames((elapsed) => {
			this.#glide = stepSpring(this.#glide, this.#target, elapsed);
			this.#scrollTo(snap(this.#glide.position));
			if (this.#glide.position !== this.#target || this.#glide.velocity !== 0) return true;
			this.#stop = null;
			this.#reconcile(true);
			return false;
		});
	}
}

export function flyOut(onLand: () => void): Attachment<HTMLElement> {
	return (ghost) => {
		const travel = ghost.offsetTop + ghost.offsetHeight;
		if (reducedMotion() || travel <= 0) {
			onLand();
			return;
		}
		let glide: Glide = { position: 0, velocity: 0 };
		const paint = (): void => {
			ghost.style.transform = `translateY(${-glide.position}px)`;
			ghost.style.opacity = String(1 - glide.position / travel);
		};
		paint();
		return frames((elapsed) => {
			glide = stepSpring(glide, travel, elapsed);
			if (glide.position === travel) {
				onLand();
				return false;
			}
			paint();
			return true;
		});
	};
}

export function fitWidth(minWidthPx: number): Attachment<HTMLElement> {
	return (node) => {
		const host = node.parentElement;
		if (!host) return;
		const observer = new ResizeObserver(() => {
			const ratio = host.clientWidth / minWidthPx;
			node.style.zoom = ratio < 1 ? String(ratio) : '';
		});
		observer.observe(host);
		return () => observer.disconnect();
	};
}
