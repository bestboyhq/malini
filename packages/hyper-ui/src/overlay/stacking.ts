export const OVERLAY_Z_INDEX = {
	popover: 1_000,
	modal: 10_050,
} as const;

const EXCLUSIVE_OVERLAY_OPEN_EVENT = 'hyper-ui:exclusive-overlay-open';

export function announceExclusiveOverlayOpen(): void {
	if (typeof document === 'undefined') return;
	document.dispatchEvent(new Event(EXCLUSIVE_OVERLAY_OPEN_EVENT));
}

export function onExclusiveOverlayOpen(listener: () => void): () => void {
	if (typeof document === 'undefined') return () => undefined;
	document.addEventListener(EXCLUSIVE_OVERLAY_OPEN_EVENT, listener);
	return () => document.removeEventListener(EXCLUSIVE_OVERLAY_OPEN_EVENT, listener);
}

export function isExclusiveOverlayActive(trigger?: Element | null): boolean {
	if (typeof document === 'undefined') return false;
	if (trigger?.closest('[data-dropdown-portal], [data-hovercard-portal], [data-overlay-portal]')) {
		return false;
	}
	return Boolean(
		document.querySelector('[data-dropdown-portal], [data-hovercard-portal], [data-overlay-layer]'),
	);
}

export function isWithinOverlaySurface(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest(
			'[data-overlay-layer], [data-overlay-portal], [data-dropdown-portal], [data-submenu-portal], [data-hovercard-portal]',
		) !== null
	);
}

export type EscapeScopeDismiss = () => void;

const escapeScopes: { dismiss: EscapeScopeDismiss }[] = [];
let escapeListening = false;

export function dismissInnermostOverlay(): boolean {
	const innermost = escapeScopes.at(-1);
	if (!innermost) return false;
	innermost.dismiss();
	return true;
}

function onEscapeKeydown(event: KeyboardEvent): void {
	if (event.key !== 'Escape' || event.defaultPrevented) return;
	if (!dismissInnermostOverlay()) return;
	event.preventDefault();
	event.stopPropagation();
}

export function registerEscapeScope(dismiss: EscapeScopeDismiss): () => void {
	const scope = { dismiss };
	escapeScopes.push(scope);
	if (!escapeListening && typeof document !== 'undefined') {
		document.addEventListener('keydown', onEscapeKeydown);
		escapeListening = true;
	}

	return () => {
		const index = escapeScopes.indexOf(scope);
		if (index !== -1) escapeScopes.splice(index, 1);
		if (escapeScopes.length === 0 && escapeListening && typeof document !== 'undefined') {
			document.removeEventListener('keydown', onEscapeKeydown);
			escapeListening = false;
		}
	};
}

const OVERLAY_HOST_SELECTOR = [
	'[role="dialog"]',
	'[data-overlay-portal]',
	'[data-overlay-layer]',
	'[data-dropdown-portal]',
	'[data-hovercard-portal]',
	'[data-tooltip-portal]',
].join(',');

export function resolveOverlayZIndex(trigger: Element | null | undefined): number {
	if (!trigger || typeof document === 'undefined') return OVERLAY_Z_INDEX.popover;

	let resolved: number = OVERLAY_Z_INDEX.popover;
	let host: Element | null = trigger.closest(OVERLAY_HOST_SELECTOR);
	while (host) {
		const zIndex = Number.parseInt(getComputedStyle(host).zIndex, 10);
		if (Number.isFinite(zIndex)) resolved = Math.max(resolved, zIndex + 1);
		host = host.parentElement?.closest(OVERLAY_HOST_SELECTOR) ?? null;
	}
	return resolved;
}
