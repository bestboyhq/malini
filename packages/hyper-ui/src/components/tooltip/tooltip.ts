import {
	isExclusiveOverlayActive,
	isReturningFocus,
	onExclusiveOverlayOpen,
	overlaySuppression,
	resolveOverlayZIndex,
	type OverlaySuppressionRelease,
	type SuppressionRect,
} from '../../overlay';
import { sensitiveSegments } from '../sensitive/sensitive-segments';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipRequest {
	text: string;
	source?: HTMLElement | undefined;
	placement: TooltipPlacement;
	offset?: number | undefined;
	onlyWhenTruncated?: boolean | undefined;
}

const OPEN_DELAY = 420;
const CLOSE_DELAY = 80;
const COOL_DELAY = 320;
const EDGE_GAP = 8;
const ANCHOR_GAP = 8;
const MORPH_MS = 240;
const SLIDE_X = 10;
const SLIDE_Y = 4;
const TOOLTIP_ID = 'hyper-tooltip';
const OVERLAY_PORTAL = '[data-dropdown-portal], [data-hovercard-portal], [data-overlay-portal]';
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

let root: HTMLDivElement | null = null;
let bubble: HTMLSpanElement | null = null;
let view: HTMLSpanElement | null = null;
let content: HTMLSpanElement | null = null;
let ghost: HTMLSpanElement | null = null;
let anchor: HTMLElement | null = null;
let described: HTMLElement | null = null;
let contentKey: string | HTMLElement = '';
let placement: TooltipPlacement = 'bottom';
let gap = ANCHOR_GAP;
let open = false;
let warm = false;
let openTimer = 0;
let closeTimer = 0;
let coolTimer = 0;
let morphTimer = 0;
let morphW = 0;
let morphH = 0;
let listening = false;
let releaseSuppression: OverlaySuppressionRelease | null = null;

function ensure(): void {
	if (root) {
		if (!root.isConnected) document.body.appendChild(root);
		return;
	}

	root = document.createElement('div');
	root.className = 'hyper-tooltip snap';
	root.dataset.tooltipPortal = '';

	bubble = document.createElement('span');
	bubble.className = 'hyper-tooltip-bubble';
	bubble.id = TOOLTIP_ID;
	bubble.setAttribute('role', 'tooltip');

	view = document.createElement('span');
	view.className = 'hyper-tooltip-view';

	content = document.createElement('span');
	content.className = 'hyper-tooltip-text';

	view.appendChild(content);
	bubble.appendChild(view);
	root.appendChild(bubble);
	document.body.appendChild(root);

	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		window.clearTimeout(openTimer);
		window.clearTimeout(closeTimer);
		if (open) close();
	});
	onExclusiveOverlayOpen(() => {
		if (anchor?.closest(OVERLAY_PORTAL)) return;
		window.clearTimeout(openTimer);
		window.clearTimeout(closeTimer);
		close();
	});
}

function outerW(element: HTMLElement): number {
	return Math.ceil(element.getBoundingClientRect().width);
}

function outerH(element: HTMLElement): number {
	return Math.ceil(element.getBoundingClientRect().height);
}

function keyOf(request: TooltipRequest): string | HTMLElement {
	return request.source ?? request.text;
}

function fill(element: HTMLSpanElement, request: TooltipRequest): void {
	if (request.source) {
		// ponytail: snippet content is cloned once per source element, so a snippet whose output changes shows stale text; re-clone on a content version key if one ever does
		element.replaceChildren(...[...request.source.childNodes].map((node) => node.cloneNode(true)));
		return;
	}
	element.replaceChildren(
		...sensitiveSegments(request.text).map((segment) => {
			if (!segment.kind) return document.createTextNode(segment.text);
			const mask = document.createElement('span');
			mask.className = 'hyper-sensitive-mask';
			mask.dataset.sensitive = segment.kind;
			mask.textContent = segment.text;
			return mask;
		}),
	);
}

function endMorph(): void {
	window.clearTimeout(morphTimer);
	morphW = 0;
	morphH = 0;
	ghost?.remove();
	ghost = null;
	if (bubble) {
		bubble.classList.remove('morph');
		bubble.style.width = '';
		bubble.style.height = '';
	}
	if (content) {
		content.classList.remove('enter');
		content.style.width = '';
	}
}

function setContent(request: TooltipRequest): void {
	if (!content || contentKey === keyOf(request)) return;
	endMorph();
	contentKey = keyOf(request);
	fill(content, request);
}

function morphContent(request: TooltipRequest, dx: number, dy: number): void {
	if (!bubble || !view || !content || contentKey === keyOf(request)) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		setContent(request);
		return;
	}

	endMorph();

	const previousW = outerW(bubble);
	const previousH = outerH(bubble);

	ghost = content;
	ghost.style.width = `${outerW(ghost)}px`;
	ghost.style.height = `${outerH(ghost)}px`;
	ghost.className = 'hyper-tooltip-text hyper-tooltip-ghost';

	contentKey = keyOf(request);
	content = document.createElement('span');
	content.className = 'hyper-tooltip-text';
	fill(content, request);
	view.appendChild(content);

	morphW = outerW(bubble);
	morphH = outerH(bubble);
	content.style.width = `${outerW(content)}px`;
	content.classList.add('enter');

	bubble.style.setProperty('--dx', `${dx}px`);
	bubble.style.setProperty('--dy', `${dy}px`);
	bubble.style.width = `${previousW}px`;
	bubble.style.height = `${previousH}px`;
	void bubble.offsetWidth;
	bubble.classList.add('morph');
	bubble.style.width = `${morphW}px`;
	bubble.style.height = `${morphH}px`;

	morphTimer = window.setTimeout(endMorph, MORPH_MS);
}

function hasContent(request: TooltipRequest): boolean {
	return Boolean(request.text || request.source);
}

function shows(node: HTMLElement, request: TooltipRequest): boolean {
	return hasContent(request) && (!request.onlyWhenTruncated || truncated(node));
}

function truncated(node: HTMLElement): boolean {
	return [node, ...node.querySelectorAll('*')].some(clipsContent);
}

function clipsContent(element: Element): boolean {
	const hiddenWidth = element.scrollWidth - element.clientWidth;
	const hiddenHeight = element.scrollHeight - element.clientHeight;
	if (hiddenWidth <= 0 && hiddenHeight <= 0) return false;
	const style = getComputedStyle(element);
	if (style.overflow === 'visible') return false;
	return hiddenWidth > 0 || hiddenHeight > parseFloat(style.fontSize) / 2;
}

function within(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), Math.max(low, high));
}

function place(x: number, y: number, snap: boolean): void {
	if (!root) return;
	if (snap) root.classList.add('snap');
	root.style.transform = `translate(${x}px, ${y}px)`;
	if (snap) requestAnimationFrame(() => root?.classList.remove('snap'));
}

function reposition(snap: boolean): void {
	if (!root || !bubble || !anchor?.isConnected) return;

	const rect = anchor.getBoundingClientRect();
	const w = morphW || bubble.offsetWidth;
	const h = morphH || bubble.offsetHeight;

	if (placement === 'left' || placement === 'right') {
		const fitsRight = rect.right + gap + w <= window.innerWidth - EDGE_GAP;
		const fitsLeft = rect.left - gap - w >= EDGE_GAP;
		const right = placement === 'right' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
		root.classList.remove('below');
		root.classList.toggle('right', right);
		root.classList.toggle('left', !right);
		place(
			right ? rect.right + gap : rect.left - gap,
			within(rect.top + rect.height / 2, EDGE_GAP + h / 2, window.innerHeight - EDGE_GAP - h / 2),
			snap,
		);
		return;
	}

	const fitsAbove = rect.top - gap - h >= EDGE_GAP;
	const fitsBelow = rect.bottom + gap + h <= window.innerHeight - EDGE_GAP;
	const below = placement === 'bottom' ? fitsBelow || !fitsAbove : !fitsAbove;
	root.classList.remove('left', 'right');
	root.classList.toggle('below', below);
	place(
		within(rect.left + rect.width / 2, w / 2 + EDGE_GAP, window.innerWidth - w / 2 - EDGE_GAP),
		below ? rect.bottom + gap : rect.top - gap,
		snap,
	);
}

function onViewportChange(): void {
	reposition(true);
}

function listen(on: boolean): void {
	if (on === listening) return;
	listening = on;
	if (on) {
		window.addEventListener('scroll', onViewportChange, true);
		window.addEventListener('resize', onViewportChange);
	} else {
		window.removeEventListener('scroll', onViewportChange, true);
		window.removeEventListener('resize', onViewportChange);
	}
}

function describe(target: HTMLElement): void {
	const ids = new Set(
		(target.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(Boolean),
	);
	ids.add(TOOLTIP_ID);
	target.setAttribute('aria-describedby', [...ids].join(' '));
	described = target;
}

function undescribe(): void {
	if (!described) return;
	const ids = (described.getAttribute('aria-describedby') ?? '')
		.split(/\s+/u)
		.filter((id) => id && id !== TOOLTIP_ID);
	if (ids.length > 0) described.setAttribute('aria-describedby', ids.join(' '));
	else described.removeAttribute('aria-describedby');
	described = null;
}

function measureBubble(): SuppressionRect | null {
	if (!bubble?.isConnected) return null;
	const box = bubble.getBoundingClientRect();
	if (box.width === 0 && box.height === 0) return null;
	return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function commit(snap: boolean): void {
	if (!root || !anchor?.isConnected || isExclusiveOverlayActive(anchor)) return;
	open = true;
	warm = true;
	root.style.zIndex = String(resolveOverlayZIndex(anchor));
	root.classList.add('open');
	undescribe();
	describe(anchor.querySelector<HTMLElement>(FOCUSABLE) ?? anchor);
	reposition(snap);
	listen(true);
	releaseSuppression ??= overlaySuppression.suppress(measureBubble);
}

function showTooltip(next: HTMLElement, request: TooltipRequest, immediate = false): void {
	if (!shows(next, request) || isExclusiveOverlayActive(next)) return;
	ensure();
	placement = request.placement;
	gap = request.offset ?? ANCHOR_GAP;
	window.clearTimeout(openTimer);
	window.clearTimeout(closeTimer);
	window.clearTimeout(coolTimer);

	const previous = anchor;
	anchor = next;

	if (open) {
		let dx = 0;
		let dy = 0;
		if (previous && previous !== next && previous.isConnected) {
			const from = previous.getBoundingClientRect();
			const to = next.getBoundingClientRect();
			const shift = to.left + to.width / 2 - (from.left + from.width / 2);
			if (Math.abs(shift) > 1) dx = Math.sign(shift) * SLIDE_X;
			const verticalShift = to.top + to.height / 2 - (from.top + from.height / 2);
			if (!dx && Math.abs(verticalShift) > 1) dy = Math.sign(verticalShift) * SLIDE_X;
		}
		morphContent(request, dx, dx || dy ? dy : SLIDE_Y);
		commit(false);
		return;
	}

	setContent(request);

	if (warm || immediate) {
		commit(true);
		return;
	}

	reposition(true);
	openTimer = window.setTimeout(() => commit(true), OPEN_DELAY);
}

function close(): void {
	open = false;
	root?.classList.remove('open');
	undescribe();
	listen(false);
	releaseSuppression?.();
	releaseSuppression = null;

	window.clearTimeout(coolTimer);
	coolTimer = window.setTimeout(() => {
		warm = false;
	}, COOL_DELAY);
}

function hideTooltip(from: HTMLElement, immediate = false): void {
	if (anchor !== from) return;
	window.clearTimeout(openTimer);
	window.clearTimeout(closeTimer);
	if (open && !immediate) closeTimer = window.setTimeout(close, CLOSE_DELAY);
	else close();
}

function refresh(node: HTMLElement, request: TooltipRequest | null): void {
	if (anchor !== node) return;
	if (!request || !shows(node, request)) {
		hideTooltip(node, true);
		return;
	}
	placement = request.placement;
	gap = request.offset ?? ANCHOR_GAP;
	if (!open) {
		setContent(request);
		return;
	}
	morphContent(request, 0, SLIDE_Y);
	reposition(false);
}

export function tooltip(
	node: HTMLElement,
	initial: TooltipRequest | null,
): { update(next: TooltipRequest | null): void; destroy(): void } {
	let request = initial;

	function onPointerEnter(event: PointerEvent): void {
		if (event.pointerType !== 'touch' && request) showTooltip(node, request);
	}

	function onPointerLeave(): void {
		hideTooltip(node);
	}

	function onFocusIn(event: FocusEvent): void {
		if (!request || isReturningFocus()) return;
		if (event.target instanceof Element && event.target.matches(':focus-visible')) {
			showTooltip(node, request, true);
		}
	}

	function onFocusOut(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
		hideTooltip(node);
	}

	node.addEventListener('pointerenter', onPointerEnter);
	node.addEventListener('pointerleave', onPointerLeave);
	node.addEventListener('focusin', onFocusIn);
	node.addEventListener('focusout', onFocusOut);

	return {
		update(next: TooltipRequest | null): void {
			request = next;
			refresh(node, next);
		},
		destroy(): void {
			node.removeEventListener('pointerenter', onPointerEnter);
			node.removeEventListener('pointerleave', onPointerLeave);
			node.removeEventListener('focusin', onFocusIn);
			node.removeEventListener('focusout', onFocusOut);
			hideTooltip(node, true);
			if (anchor === node) anchor = null;
		},
	};
}
