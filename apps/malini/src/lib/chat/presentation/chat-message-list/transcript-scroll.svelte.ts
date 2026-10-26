import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import { createScrollGlide, snapToDevicePixel } from '../scroll-glide';
import { arrivalMotion } from '../arrival-motion';

export type TranscriptFollow = 'bottom' | 'reader';

type LayoutCause = 'content' | 'frame';

const ANCHOR_ROWS = ':scope > :not([data-prompt-row])';

const RUNS = ':scope > [data-run-id]';

const TOOL_ROWS = ['tool', 'bash', 'file', 'activity-group']
	.map((kind) => `[data-message-kind="${kind}"]`)
	.join(', ');

const OVERLAYS = '[data-overlay-layer]';

const DISCLOSURE_OPENERS =
	'details:not([open]) > summary, [aria-expanded="false"]:not([aria-haspopup])';

const OPEN_DISCLOSURES = 'details[open], [aria-expanded="true"]:not([aria-haspopup])';

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
const HOVER_RELEASE_MS = 200;
const REMEMBER_DELAY_MS = 250;
const OPEN_SETTLE_MS = 1_000;
const RESTORE_WAIT_MS = 1_500;
const AT_BOTTOM_PX = 2;
const SUBPIXEL_SLACK_PX = 1;
const ROUNDED_SCROLL_HEIGHT_PX = 1;

export type TranscriptScroll = {
	readonly follow: TranscriptFollow;
	readonly contentBelow: boolean;
	readonly newContentBelow: boolean;
	readonly opening: boolean;
	readonly awaitingAnchor: boolean;
	observe(viewport: HTMLElement, messageList: HTMLElement): () => void;
	handleScroll(element: HTMLElement): void;
	handleWheel(event: WheelEvent): void;
	releaseScrollPin(): void;
	followSpaceBelowChange(spaceBelowPx: number, overlayBelowPx: number): void;
	holdBottomAnchor(): void;
	open(key: string, remembered: TranscriptAnchor | null): void;
	abandonRestore(): void;
	leave(): void;
	followNewContent(): void;
	showNewPrompt(fromComposer: boolean): void;
	jumpToLatest(): void;
	revealOlderContent(reference: HTMLElement | null, mutate: () => Promise<void>): Promise<void>;
	holdRowTop(row: HTMLElement, mutate: () => void | Promise<void>): Promise<void>;
	cancelGlide(): void;
	destroy(): void;
};

export function createTranscriptScroll(
	input: {
		prefersReducedMotion?: () => boolean;
		remember?: (key: string, anchor: TranscriptAnchor | null) => void;
	} = {},
): TranscriptScroll {
	const prefersReducedMotion = input.prefersReducedMotion ?? (() => false);
	let viewportEl: HTMLElement | null = null;
	let messageListEl: HTMLElement | null = null;
	let follow = $state<TranscriptFollow>('bottom');
	let contentBelow = $state(false);
	let newContentBelow = $state(false);
	let openKey: string | null = null;
	let opening = true;
	let openedAt = 0;
	let heldTop = 0;
	let shownTop = 0;
	let holdSpacePx = 0;
	let spaceBelowPx = 0;
	let overlayBelowPx = 0;
	let coveredPx = 0;
	let bottomAnchor: Readonly<{ distance: number; until: number }> | null = null;
	let latestRun: Readonly<{ element: HTMLElement; top: number }> | null = null;
	let laidOutHeight = 0;
	let userIntentUntil = 0;
	let pointerScrolling = false;
	let hovering = false;
	let hoverReleaseTimer: ReturnType<typeof setTimeout> | null = null;
	let rememberTimer: ReturnType<typeof setTimeout> | null = null;
	let reconcileFrame: number | null = null;
	let openingRepinQueued = false;
	let anchor: TranscriptAnchor | null = null;
	let anchorStale = false;
	let restoring = false;
	let awaitingAnchor = $state(false);
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let requestedTop: number | null = null;
	let pointerTarget: EventTarget | null = null;
	let pointerFrame: number | null = null;

	const glideTarget = {
		get scrollTop(): number {
			return viewportEl?.scrollTop ?? 0;
		},
		set scrollTop(value: number) {
			scrollTo(snapToDevicePixel(value));
		},
	};

	const scrollGlide = createScrollGlide({
		stiffness: () => arrivalMotion().glideStiffness,
		onSettle: () => reconcile('content'),
	});

	function scrollTo(value: number): void {
		shownTop = value;
		if (viewportEl && viewportEl.scrollTop !== value) viewportEl.scrollTop = value;
	}

	function setHoldSpace(px: number): void {
		const next = px > 0 ? Math.ceil(px) + ROUNDED_SCROLL_HEIGHT_PX : 0;
		if (next === holdSpacePx || (next > 0 && holdsWithHeadroom(px))) return;
		holdSpacePx = next;
		messageListEl?.style.setProperty('--chat-hold-space', `${next}px`);
	}

	function holdsWithHeadroom(px: number): boolean {
		const headroom = holdSpacePx - px;
		return headroom >= ROUNDED_SCROLL_HEIGHT_PX && headroom <= 2 * ROUNDED_SCROLL_HEIGHT_PX;
	}

	function naturalMaxTop(viewport: HTMLElement): number {
		return Math.max(0, viewport.scrollHeight - holdSpacePx - viewport.clientHeight);
	}

	function readAnchor(viewport: HTMLElement, list: HTMLElement): TranscriptAnchor | null {
		const top = viewport.getBoundingClientRect().top;
		const runs = list.querySelectorAll<HTMLElement>(RUNS);
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
		const runs = list.querySelectorAll<HTMLElement>(RUNS);
		const run = [...runs].find((candidate) => candidate.dataset['runId'] === runId);
		const rowTop = run?.querySelectorAll(ANCHOR_ROWS)[row]?.getBoundingClientRect().top;
		if (rowTop === undefined) return null;
		return Math.max(0, viewport.scrollTop + rowTop - viewport.getBoundingClientRect().top - offset);
	}

	function rememberAnchor(): void {
		if (follow === 'reader' && !restoring) anchorStale = true;
	}

	function readStaleAnchor(): void {
		if (!anchorStale || follow !== 'reader' || restoring) return;
		if (!viewportEl?.isConnected || !messageListEl) return;
		anchorStale = false;
		anchor = readAnchor(viewportEl, messageListEl);
	}

	function rememberNow(): void {
		cancelRemember();
		readStaleAnchor();
		if (openKey === null) return;
		input.remember?.(openKey, follow === 'reader' ? anchor : null);
	}

	function rememberSoon(): void {
		if (rememberTimer !== null || !input.remember) return;
		rememberTimer = setTimeout(rememberNow, REMEMBER_DELAY_MS);
	}

	function cancelRemember(): void {
		if (rememberTimer === null) return;
		clearTimeout(rememberTimer);
		rememberTimer = null;
	}

	function updateContentBelow(): void {
		const viewport = viewportEl;
		if (follow === 'bottom' && !hovering) newContentBelow = false;
		contentBelow =
			viewport !== null &&
			(follow === 'reader' || hovering) &&
			naturalMaxTop(viewport) - coveredPx - viewport.scrollTop > AT_BOTTOM_PX;
	}

	function targetTop(viewport: HTMLElement, list: HTMLElement): number {
		const naturalMax = naturalMaxTop(viewport);
		if (bottomAnchor && performance.now() > bottomAnchor.until) bottomAnchor = null;
		const restored = follow === 'reader' && restoring ? anchoredTop(viewport, list) : null;
		awaitingAnchor = follow === 'reader' && restoring && restored === null;
		if (restored !== null) return restored;
		if (bottomAnchor) return Math.max(0, naturalMax - bottomAnchor.distance);
		if (follow === 'reader' && restoring) return naturalMax;
		if (follow === 'reader') return heldTop;
		if (hovering && !opening) return heldTop;
		return naturalMax - coveredPx;
	}

	function coversWithOverlay(): boolean {
		// ponytail: a tray loading over 1s after open covers the end; key this to its data if it bites
		return follow === 'bottom' && performance.now() - openedAt > OPEN_SETTLE_MS;
	}

	function uncover(): void {
		coveredPx = Math.min(0, coveredPx);
	}

	function fillBlankBelow(viewport: HTMLElement): void {
		if (coveredPx >= 0) return;
		coveredPx = Math.max(coveredPx, Math.min(0, naturalMaxTop(viewport) - shownTop));
	}

	function revealContentChange(): void {
		uncover();
		reconcile('content');
	}

	function glides(): boolean {
		return !opening && !hovering && !prefersReducedMotion() && follow === 'bottom';
	}

	function browserClamped(viewport: HTMLElement): boolean {
		const top = viewport.scrollTop;
		return top < shownTop && top >= viewport.scrollHeight - viewport.clientHeight - 1;
	}

	function reconcile(cause: LayoutCause): void {
		const viewport = viewportEl;
		const list = messageListEl;
		if (!viewport || !list) return;
		const shrunkUnderView = !userIsScrolling() && browserClamped(viewport);
		const browserHeldView =
			!shrunkUnderView && Math.abs(viewport.scrollTop - shownTop) >= SUBPIXEL_SLACK_PX;
		if (follow === 'reader' && !restoring && (!shrunkUnderView || requestedTop !== null)) {
			heldTop = requestedTop ?? viewport.scrollTop;
		}
		requestedTop = null;
		if (!userIsScrolling() && !shrunkUnderView) shownTop = viewport.scrollTop;
		const shift =
			follow === 'bottom' && !userIsScrolling() && !browserHeldView
				? shiftAboveLatestRun(viewport)
				: 0;
		shownTop = Math.max(0, shownTop + shift);
		if (hovering) heldTop += shift;
		fillBlankBelow(viewport);
		const target = targetTop(viewport, list);
		const animate = glides() && cause === 'content';
		const holdShown = animate && (scrollGlide.isGliding || shrunkUnderView || shift !== 0);
		const reach = holdShown ? Math.max(target, shownTop) : target;
		setHoldSpace(reach - naturalMaxTop(viewport));
		heldTop = target;
		if (animate) {
			if (shrunkUnderView || shift !== 0) scrollTo(shownTop);
			scrollGlide.glide(glideTarget, target);
		} else {
			scrollGlide.cancel();
			scrollTo(target);
			rememberAnchor();
		}
		trackLatestRun(viewport, list);
		updateContentBelow();
		rememberSoon();
	}

	function contentTop(viewport: HTMLElement, element: HTMLElement): number {
		const viewportTop = viewport.getBoundingClientRect().top;
		return element.getBoundingClientRect().top - viewportTop + viewport.scrollTop;
	}

	function shiftAboveLatestRun(viewport: HTMLElement): number {
		if (!latestRun?.element.isConnected) return 0;
		const shift = contentTop(viewport, latestRun.element) - latestRun.top;
		return Math.abs(shift) < SUBPIXEL_SLACK_PX ? 0 : shift;
	}

	function trackLatestRun(viewport: HTMLElement, list: HTMLElement): void {
		laidOutHeight = viewport.scrollHeight;
		const runs = list.querySelectorAll<HTMLElement>(RUNS);
		const run = follow === 'bottom' ? runs[runs.length - 1] : undefined;
		latestRun = run ? { element: run, top: contentTop(viewport, run) } : null;
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

	function holdStill(): void {
		scrollGlide.cancel();
		cancelScheduledReconcile();
		heldTop = viewportEl?.scrollTop ?? heldTop;
		shownTop = heldTop;
	}

	function stopRestoring(): void {
		restoring = false;
		awaitingAnchor = false;
		if (restoreTimer !== null) clearTimeout(restoreTimer);
		restoreTimer = null;
	}

	function abandonRestore(): void {
		if (!awaitingAnchor) return;
		reconcile('frame');
		if (!awaitingAnchor) return;
		stopRestoring();
		anchor = null;
		follow = 'bottom';
		reconcile('frame');
	}

	function becomeReader(): void {
		holdStill();
		opening = false;
		stopRestoring();
		bottomAnchor = null;
		coveredPx = 0;
		follow = 'reader';
		rememberAnchor();
		updateContentBelow();
		rememberSoon();
	}

	function followBottom(): void {
		opening = false;
		stopRestoring();
		anchor = null;
		bottomAnchor = null;
		coveredPx = 0;
		follow = 'bottom';
	}

	function scrollsBeyondView(): boolean {
		const viewport = viewportEl;
		return viewport !== null && viewport.scrollHeight > viewport.clientHeight;
	}

	function userIsScrolling(): boolean {
		return pointerScrolling || performance.now() < userIntentUntil;
	}

	function acceptUserScroll(viewport: HTMLElement, byUser: boolean): void {
		scrollGlide.cancel();
		cancelScheduledReconcile();
		opening = false;
		stopRestoring();
		bottomAnchor = null;
		const top = viewport.scrollTop;
		const naturalMax = naturalMaxTop(viewport);
		const scrolledUp = byUser && top < shownTop;
		follow = !scrolledUp && top >= naturalMax - coveredPx - AT_BOTTOM_PX ? 'bottom' : 'reader';
		coveredPx = follow === 'bottom' ? Math.min(coveredPx, Math.max(0, naturalMax - top)) : 0;
		heldTop = top;
		shownTop = top;
		setHoldSpace(top - naturalMax);
		if (messageListEl) trackLatestRun(viewport, messageListEl);
		rememberAnchor();
		updateContentBelow();
		rememberSoon();
	}

	function clearHoverRelease(): void {
		if (hoverReleaseTimer === null) return;
		clearTimeout(hoverReleaseTimer);
		hoverReleaseTimer = null;
	}

	function holdForHover(): void {
		clearHoverRelease();
		if (hovering) return;
		hovering = true;
		if (follow === 'bottom') holdStill();
		updateContentBelow();
	}

	function releaseHoverSoon(): void {
		if (!hovering || hoverReleaseTimer !== null) return;
		hoverReleaseTimer = setTimeout(() => {
			hoverReleaseTimer = null;
			hovering = false;
			reconcile('content');
		}, HOVER_RELEASE_MS);
	}

	function stopHovering(): void {
		clearHoverRelease();
		hovering = false;
	}

	function holdsFollow(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		if (target.closest(OVERLAYS)) return true;
		return messageListEl?.contains(target) === true && insideExpandedToolRow(target);
	}

	function insideExpandedToolRow(target: Element): boolean {
		const row = target.closest(TOOL_ROWS);
		if (!row) return false;
		const outer = row.parentElement?.closest(TOOL_ROWS);
		if (outer) return insideExpandedToolRow(outer);
		return [...row.querySelectorAll(OPEN_DISCLOSURES)].some((open) => open.checkVisibility());
	}

	function onDocumentPointerMove(event: PointerEvent): void {
		pointerTarget = event.target;
		pointerFrame ??= requestAnimationFrame(followPointer);
	}

	function followPointer(): void {
		pointerFrame = null;
		if (holdsFollow(pointerTarget)) holdForHover();
		else releaseHoverSoon();
	}

	function cancelPointerFrame(): void {
		if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
		pointerFrame = null;
	}

	function onDocumentPointerOut(event: PointerEvent): void {
		if (event.relatedTarget === null) releaseHoverSoon();
	}

	function onListClick(event: MouseEvent): void {
		if (event.target instanceof Element && event.target.closest(DISCLOSURE_OPENERS)) becomeReader();
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

	async function holdRowTop(row: HTMLElement, mutate: () => void | Promise<void>): Promise<void> {
		const before = row.getBoundingClientRect().top;
		becomeReader();
		await mutate();
		const viewport = viewportEl;
		const moved = row.getBoundingClientRect().top - before;
		if (!viewport || Math.abs(moved) <= 0.5) return;
		requestedTop = Math.max(0, viewport.scrollTop + moved);
		reconcile('content');
	}

	return {
		get follow(): TranscriptFollow {
			return follow;
		},

		get contentBelow(): boolean {
			return contentBelow;
		},

		get newContentBelow(): boolean {
			return newContentBelow;
		},

		get opening(): boolean {
			return opening;
		},

		get awaitingAnchor(): boolean {
			return awaitingAnchor;
		},

		observe(viewport: HTMLElement, messageList: HTMLElement): () => void {
			viewportEl = viewport;
			messageListEl = messageList;
			holdSpacePx = 0;
			latestRun = null;
			messageList.style.setProperty('--chat-hold-space', '0px');
			const sizeObserver = new ResizeObserver((entries) => {
				if (entries.some((entry) => entry.target === viewport)) reconcile('frame');
				if (entries.some((entry) => entry.target === messageList)) revealContentChange();
			});
			sizeObserver.observe(viewport);
			sizeObserver.observe(messageList);
			const mutationObserver = new MutationObserver(revealContentChange);
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
			document.addEventListener('pointermove', onDocumentPointerMove, {
				capture: true,
				passive: true,
			});
			document.addEventListener('pointerout', onDocumentPointerOut, true);
			viewport.addEventListener('pointerdown', onViewportPointerDown);
			messageList.addEventListener('click', onListClick, true);
			window.addEventListener('pagehide', rememberNow);
			return () => {
				messageList.removeEventListener('click', onListClick, true);
				document.removeEventListener('keydown', onDocumentKeydown, true);
				document.removeEventListener('pointerup', onPointerUp, true);
				document.removeEventListener('pointermove', onDocumentPointerMove, true);
				cancelPointerFrame();
				document.removeEventListener('pointerout', onDocumentPointerOut, true);
				viewport.removeEventListener('pointerdown', onViewportPointerDown);
				window.removeEventListener('pagehide', rememberNow);
				sizeObserver.disconnect();
				mutationObserver.disconnect();
				stopHovering();
				contentBelow = false;
			};
		},

		handleScroll(element: HTMLElement): void {
			viewportEl = element;
			if (userIsScrolling()) {
				acceptUserScroll(element, true);
				return;
			}
			if (Math.abs(element.scrollTop - shownTop) <= 1) {
				updateContentBelow();
				return;
			}
			if (browserClamped(element) || element.scrollHeight !== laidOutHeight) {
				reconcile('content');
				return;
			}
			acceptUserScroll(element, false);
		},

		handleWheel(event: WheelEvent): void {
			userIntentUntil = performance.now() + WHEEL_INTENT_MS;
			if (event.deltaY < 0 && scrollsBeyondView()) becomeReader();
		},

		releaseScrollPin: becomeReader,

		followSpaceBelowChange(px: number, overlayPx: number): void {
			const covered = coversWithOverlay() ? coveredPx + overlayPx - overlayBelowPx : 0;
			const moved = px - spaceBelowPx - (covered - coveredPx);
			spaceBelowPx = px;
			overlayBelowPx = overlayPx;
			coveredPx = covered;
			if (!glides()) {
				reconcile('frame');
				return;
			}
			scrollTo(shownTop + moved);
			reconcile('content');
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
			scheduleReconcile();
		},

		open(key: string, remembered: TranscriptAnchor | null): void {
			openKey = key;
			newContentBelow = false;
			bottomAnchor = null;
			opening = true;
			openedAt = performance.now();
			coveredPx = 0;
			latestRun = null;
			anchor = remembered;
			stopRestoring();
			restoring = remembered !== null;
			follow = restoring ? 'reader' : 'bottom';
			if (restoring) {
				restoreTimer = setTimeout(() => {
					restoreTimer = null;
					abandonRestore();
				}, RESTORE_WAIT_MS);
			}
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

		leave: rememberNow,

		abandonRestore,

		followNewContent(): void {
			if (!opening && (follow === 'reader' || hovering)) newContentBelow = true;
			opening = false;
			uncover();
			scheduleReconcile();
		},

		showNewPrompt(fromComposer: boolean): void {
			opening = false;
			if (!fromComposer && follow === 'reader') return;
			if (fromComposer) stopHovering();
			followBottom();
			scheduleReconcile();
		},

		jumpToLatest(): void {
			stopHovering();
			followBottom();
			reconcile('content');
		},

		holdRowTop,

		async revealOlderContent(
			reference: HTMLElement | null,
			mutate: () => Promise<void>,
		): Promise<void> {
			if (reference) return holdRowTop(reference, mutate);
			becomeReader();
			await mutate();
		},

		cancelGlide(): void {
			scrollGlide.cancel();
		},

		destroy(): void {
			stopRestoring();
			cancelScheduledReconcile();
			cancelPointerFrame();
			cancelRemember();
			stopHovering();
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
