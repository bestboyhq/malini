import { registerEscapeScope } from '../../overlay';

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(', ');

let scrollLockCount = 0;

function lockBodyScroll(): void {
	scrollLockCount += 1;
	if (scrollLockCount === 1) {
		document.body.style.setProperty('overflow', 'hidden');
	}
}

function unlockBodyScroll(): void {
	scrollLockCount = Math.max(0, scrollLockCount - 1);
	if (scrollLockCount === 0) {
		document.body.style.removeProperty('overflow');
	}
}

function focusableElements(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => element.getClientRects().length > 0 || element === document.activeElement,
	);
}

function trapTab(node: HTMLElement, event: KeyboardEvent): void {
	const focusables = focusableElements(node);

	if (focusables.length === 0) {
		event.preventDefault();
		node.focus();
		return;
	}

	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	if (!first || !last) return;
	const active = document.activeElement;

	if (event.shiftKey && (active === first || active === node)) {
		event.preventDefault();
		last.focus();
		return;
	}

	if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
}

export interface ModalBehaviorOptions {
	onEscape?: () => void;
}

export function modalBehavior(
	node: HTMLElement,
	options: ModalBehaviorOptions = {},
): { destroy: () => void } {
	const previouslyFocused =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;

	if (!node.hasAttribute('tabindex')) {
		node.setAttribute('tabindex', '-1');
	}

	lockBodyScroll();
	node.focus();

	const releaseEscape = registerEscapeScope(() => options.onEscape?.());

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') {
			trapTab(node, event);
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		destroy(): void {
			releaseEscape();
			node.removeEventListener('keydown', onKeydown);
			unlockBodyScroll();
			previouslyFocused?.focus();
		},
	};
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	) {
		return true;
	}

	return target.isContentEditable;
}
