import { createScrollGlide } from '../scroll-glide';
import { arrivalMotion } from '../arrival-motion';

export type TranscriptFollow = 'bottom' | 'prompt' | 'reader';

type LayoutCause = 'content' | 'frame';

type TranscriptAnchor = Readonly<{ runId: string; row: number; offset: number }>;

type TranscriptPosition = Readonly<{ follow: TranscriptFollow; anchor: TranscriptAnchor | null }>;

const AT_BOTTOM: TranscriptPosition = { follow: 'bottom', anchor: null };

const positions = new Map<string, TranscriptPosition>();

const ANCHOR_ROWS = ':scope > :not([data-prompt-row])';

export function forgetTranscriptPositions(): void {
	positions.clear();
}

const SCROLL_UP_KEYS: ReadonlySet<string> = new Set(['PageUp', 'ArrowUp', 'Home']);
const SCROLL_KEYS: ReadonlySet<string> = new Set([
	...SCROLL_UP_KEYS,
	'PageDown',
	'ArrowDown',
	'End',
]);
const WHEEL_INTENT_MS = 250;
const KEY_INTENT_MS = 600;
const BOTTOM_ANCHOR_HOLD_MS = 600;
const AT_BOTTOM_PX = 2;

export type TranscriptScroll = {
	readonly follow: TranscriptFollow;
	observe(viewport: HTMLElement, messageList: HTMLElement): () => void;
	handleScroll(element: HTMLElement): void;
	handleWheel(event: WheelEvent): void;
	releaseScrollPin(): void;
	followSpaceBelowChange(): void;
	holdBottomAnchor(): void;
	open(key: string): void;
	leave(key: string): void;
	followNewContent(): void;
	showNewPrompt(fromComposer: boolean): void;
	revealOlderContent(mutate: () => Promise<void>): Promise<void>;
	holdRowTop(row: HTMLElement, mutate: () => void | Promise<void>): Promise<void>;
	cancelGlide(): void;
	destroy(): void;
};

export function createTranscriptScroll(
	input: { prefersReducedMotion?: () => boolean } = {},
): TranscriptScroll {
	const prefersReducedMotion = input.prefersReducedMotion ?? (() => false);
	let viewportEl: HTMLElement | null = null;
	let messageListEl: HTMLElement | null = null;
	let follow = $state<TranscriptFollow>('bottom');
	let opening = true;
	let promptGlide = false;
	let heldTop = 0;
	let shownTop = 0;
	let holdSpacePx = 0;
	let bottomAnchor: Readonly<{ distance: number; until: number }> | null = null;
	let userIntentUntil = 0;
	let pointerScrolling = false;
	let reconcileFrame: number | null = null;
	let openingRepinQueued = false;
	let anchor: TranscriptAnchor | null = null;
	let restoring = false;

	const glideTarget = {
		get scrollTop(): number {
			return viewportEl?.scrollTop ?? 0;
		},
		set scrollTop(value: number) {
			scrollTo(value);
		},
	};

	const scrollGlide = createScrollGlide({
		stiffness: () => arrivalMotion().scrollStiffness,
		onSettle: () => {
			promptGlide = false;
			reconcile('content');
		},
	});

	function scrollTo(value: number): void {
		shownTop = value;
		if (viewportEl && viewportEl.scrollTop !== value) viewportEl.scrollTop = value;
	}

	function setHoldSpace(px: number): void {
		const next = Math.max(0, Math.round(px));
		if (next === holdSpacePx) return;
		holdSpacePx = next;
		messageListEl?.style.setProperty('--chat-hold-space', `${next}px`);
	}

	function measureViewport(): void {
		const viewport = viewportEl;
		messageListEl?.style.setProperty(
			'--chat-viewport-height',
			`${viewport ? viewport.clientHeight : 0}px`,
		);
	}

	function naturalMaxTop(viewport: HTMLElement): number {
		return Math.max(0, viewport.scrollHeight - holdSpacePx - viewport.clientHeight);
	}

	function latestPromptTop(viewport: HTMLElement, list: HTMLElement): number | null {
		const run = list.lastElementChild;
		if (!(run instanceof HTMLElement) || run.dataset['runId'] === undefined) return null;
		const offset =
			run.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
		const inset = Number.parseFloat(getComputedStyle(list).paddingTop) || 0;
		return Math.max(0, offset - inset);
	}

	function readAnchor(viewport: HTMLElement, list: HTMLElement): TranscriptAnchor | null {
		const top = viewport.getBoundingClientRect().top;
		const runs = list.querySelectorAll<HTMLElement>(':scope > [data-run-id]');
		const run = runs[Math.min(firstEndingBelow(runs, top), runs.length - 1)];
		const runId = run?.dataset['runId'];
		if (!run || runId === undefined) return null;
		const rows = run.querySelectorAll(ANCHOR_ROWS);
		const row = Math.min(firstEndingBelow(rows, top), rows.length - 1);
		const rowTop = rows[row]?.getBoundingClientRect().top;
		if (rowTop === undefined) return null;
		return { runId, row, offset: rowTop - top };
	}

	function anchoredTop(viewport: HTMLElement, list: HTMLElement): number | null {
		if (!anchor) return null;
		const { runId, row, offset } = anchor;
		const runs = list.querySelectorAll<HTMLElement>(':scope > [data-run-id]');
		const run = [...runs].find((candidate) => candidate.dataset['runId'] === runId);
		const rowTop = run?.querySelectorAll(ANCHOR_ROWS)[row]?.getBoundingClientRect().top;
		if (rowTop === undefined) return null;
		return Math.max(0, viewport.scrollTop + rowTop - viewport.getBoundingClientRect().top - offset);
	}

	function rememberAnchor(): void {
		if (follow !== 'reader' || restoring || !viewportEl || !messageListEl) return;
		anchor = readAnchor(viewportEl, messageListEl);
	}

	function targetTop(viewport: HTMLElement, list: HTMLElement, cause: LayoutCause): number {
		const naturalMax = naturalMaxTop(viewport);
		if (bottomAnchor && performance.now() > bottomAnchor.until) bottomAnchor = null;
		if (bottomAnchor) return Math.max(0, naturalMax - bottomAnchor.distance);
		if (follow === 'prompt') return latestPromptTop(viewport, list) ?? heldTop;
		if (follow === 'reader' && restoring) return anchoredTop(viewport, list) ?? naturalMax;
		if (follow === 'reader') return heldTop;
		if (opening || cause === 'frame') return naturalMax;
		return Math.max(heldTop, naturalMax);
	}

	function glides(): boolean {
		if (opening || prefersReducedMotion()) return false;
		return follow === 'bottom' || (follow === 'prompt' && promptGlide);
	}

	function reconcile(cause: LayoutCause): void {
		const viewport = viewportEl;
		const list = messageListEl;
		if (!viewport || !list) return;
		const target = targetTop(viewport, list, cause);
		const animate = glides() && cause === 'content';
		const reach = animate && scrollGlide.isGliding ? Math.max(target, shownTop) : target;
		setHoldSpace(reach - naturalMaxTop(viewport));
		heldTop = target;
		if (animate) {
			scrollGlide.glide(glideTarget, target);
			return;
		}
		scrollGlide.cancel();
		promptGlide = false;
		scrollTo(target);
		rememberAnchor();
	}

	function scheduleReconcile(): void {
		if (reconcileFrame !== null) return;
		reconcileFrame = requestAnimationFrame(() => {
			reconcileFrame = null;
			reconcile('content');
		});
	}

	function cancelScheduledReconcile(): void {
		if (reconcileFrame === null) return;
		cancelAnimationFrame(reconcileFrame);
		reconcileFrame = null;
	}

	function becomeReader(): void {
		scrollGlide.cancel();
		cancelScheduledReconcile();
		promptGlide = false;
		opening = false;
		restoring = false;
		bottomAnchor = null;
		follow = 'reader';
		heldTop = viewportEl?.scrollTop ?? heldTop;
		shownTop = heldTop;
		rememberAnchor();
	}

	function scrollsBeyondView(): boolean {
		const viewport = viewportEl;
		return viewport !== null && viewport.scrollHeight > viewport.clientHeight;
	}

	function userIsScrolling(): boolean {
		return pointerScrolling || performance.now() < userIntentUntil;
	}

	function acceptUserScroll(viewport: HTMLElement): void {
		scrollGlide.cancel();
		cancelScheduledReconcile();
		promptGlide = false;
		opening = false;
		restoring = false;
		bottomAnchor = null;
		const top = viewport.scrollTop;
		const naturalMax = naturalMaxTop(viewport);
		follow = top >= naturalMax - AT_BOTTOM_PX ? 'bottom' : 'reader';
		heldTop = top;
		shownTop = top;
		setHoldSpace(top - naturalMax);
		rememberAnchor();
	}

	function onViewportPointerDown(event: PointerEvent): void {
		if (event.target !== viewportEl || !scrollsBeyondView()) return;
		pointerScrolling = true;
		becomeReader();
	}

	function onPointerUp(): void {
		if (!pointerScrolling) return;
		pointerScrolling = false;
		userIntentUntil = performance.now() + WHEEL_INTENT_MS;
	}

	function onDocumentKeydown(event: KeyboardEvent): void {
		const key = event.key === ' ' ? (event.shiftKey ? 'PageUp' : 'PageDown') : event.key;
		if (!SCROLL_KEYS.has(key) || isEditable(event.target)) return;
		const focused = document.activeElement;
		if (focused && focused !== document.body && !viewportEl?.contains(focused)) return;
		userIntentUntil = performance.now() + KEY_INTENT_MS;
		if (SCROLL_UP_KEYS.has(key) && scrollsBeyondView()) becomeReader();
	}

	return {
		get follow(): TranscriptFollow {
			return follow;
		},

		observe(viewport: HTMLElement, messageList: HTMLElement): () => void {
			viewportEl = viewport;
			messageListEl = messageList;
			holdSpacePx = 0;
			messageList.style.setProperty('--chat-hold-space', '0px');
			measureViewport();
			const viewportObserver = new ResizeObserver(() => {
				measureViewport();
				reconcile('frame');
			});
			viewportObserver.observe(viewport);
			const contentObserver = new ResizeObserver(() => reconcile('content'));
			contentObserver.observe(messageList);
			const mutationObserver = new MutationObserver(() => reconcile('content'));
			mutationObserver.observe(messageList, {
				childList: true,
				subtree: true,
				attributeFilter: ['data-tool-status', 'data-bash-status', 'data-terminal-state'],
			});
			scrollGlide.cancel();
			cancelScheduledReconcile();
			reconcile('frame');
			document.addEventListener('keydown', onDocumentKeydown, true);
			document.addEventListener('pointerup', onPointerUp, true);
			viewport.addEventListener('pointerdown', onViewportPointerDown);
			return () => {
				document.removeEventListener('keydown', onDocumentKeydown, true);
				document.removeEventListener('pointerup', onPointerUp, true);
				viewport.removeEventListener('pointerdown', onViewportPointerDown);
				viewportObserver.disconnect();
				contentObserver.disconnect();
				mutationObserver.disconnect();
			};
		},

		handleScroll(element: HTMLElement): void {
			viewportEl = element;
			if (userIsScrolling()) {
				acceptUserScroll(element);
				return;
			}
			const top = element.scrollTop;
			if (Math.abs(top - shownTop) <= 1) return;
			const clamped = top < shownTop && top >= element.scrollHeight - element.clientHeight - 1;
			if (clamped) {
				reconcile('content');
				return;
			}
			acceptUserScroll(element);
		},

		handleWheel(event: WheelEvent): void {
			userIntentUntil = performance.now() + WHEEL_INTENT_MS;
			if (event.deltaY < 0 && scrollsBeyondView()) becomeReader();
		},

		releaseScrollPin: becomeReader,

		followSpaceBelowChange(): void {
			reconcile('frame');
		},

		holdBottomAnchor(): void {
			const viewport = viewportEl;
			if (!viewport) return;
			scrollGlide.cancel();
			cancelScheduledReconcile();
			bottomAnchor = {
				distance: Math.max(0, naturalMaxTop(viewport) - viewport.scrollTop),
				until: performance.now() + BOTTOM_ANCHOR_HOLD_MS,
			};
		},

		open(key: string): void {
			const remembered = positions.get(key) ?? AT_BOTTOM;
			bottomAnchor = null;
			opening = true;
			promptGlide = false;
			anchor = remembered.anchor;
			restoring = anchor !== null;
			follow = remembered.follow === 'reader' && !restoring ? 'bottom' : remembered.follow;
			setHoldSpace(0);
			scrollGlide.cancel();
			cancelScheduledReconcile();
			reconcile('frame');
			if (openingRepinQueued) return;
			openingRepinQueued = true;
			queueMicrotask(() => {
				openingRepinQueued = false;
				if (opening) reconcile('frame');
			});
		},

		leave(key: string): void {
			positions.set(key, { follow, anchor: follow === 'reader' ? anchor : null });
		},

		followNewContent(): void {
			opening = false;
			scheduleReconcile();
		},

		showNewPrompt(fromComposer: boolean): void {
			opening = false;
			if (!fromComposer && follow === 'reader') return;
			bottomAnchor = null;
			follow = 'prompt';
			promptGlide = true;
			scheduleReconcile();
		},

		async holdRowTop(row: HTMLElement, mutate: () => void | Promise<void>): Promise<void> {
			const before = row.getBoundingClientRect().top;
			becomeReader();
			await mutate();
			const viewport = viewportEl;
			const moved = row.getBoundingClientRect().top - before;
			if (!viewport || Math.abs(moved) <= 0.5) return;
			heldTop = Math.max(0, viewport.scrollTop + moved);
			reconcile('content');
		},

		async revealOlderContent(mutate: () => Promise<void>): Promise<void> {
			becomeReader();
			const viewport = viewportEl;
			const previousHeight = viewport?.scrollHeight ?? 0;
			await mutate();
			if (!viewport) return;
			heldTop = viewport.scrollTop + viewport.scrollHeight - previousHeight;
			reconcile('content');
		},

		cancelGlide(): void {
			scrollGlide.cancel();
			promptGlide = false;
		},

		destroy(): void {
			cancelScheduledReconcile();
			scrollGlide.cancel();
		},
	};
}

function firstEndingBelow(elements: ArrayLike<Element>, y: number): number {
	let low = 0;
	let high = elements.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		const bottom = elements[middle]?.getBoundingClientRect().bottom ?? y;
		if (bottom > y) high = middle;
		else low = middle + 1;
	}
	return low;
}

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}
