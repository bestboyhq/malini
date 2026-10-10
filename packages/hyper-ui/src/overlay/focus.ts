import { getContext, setContext, tick } from 'svelte';

const FOCUS_RETURN_KEY = Symbol('hyper-overlay-focus-return');

export type OverlayFocusReturn = () => boolean;

export function setOverlayFocusReturn(focusReturn: OverlayFocusReturn): void {
	setContext(FOCUS_RETURN_KEY, focusReturn);
}

export function getOverlayFocusReturn(): OverlayFocusReturn | undefined {
	return getContext<OverlayFocusReturn | undefined>(FOCUS_RETURN_KEY);
}

const INTERACTIVE_ITEM_SELECTOR = [
	'[role="option"]:not([aria-disabled="true"])',
	'[role="menuitem"]:not([aria-disabled="true"])',
	'button:not(:disabled)',
	'a[href]',
	'[tabindex]:not([tabindex="-1"])',
].join(', ');

export type RovingFocusDirection = 'next' | 'previous' | 'first' | 'last';

export interface RovingFocusOptions {
	container: () => HTMLElement | null;
	anchor?: () => HTMLElement | null;
	restoreFocus?: () => boolean;
	canRestore?: () => boolean;
	focusReturn?: OverlayFocusReturn | undefined;
}

export interface RovingFocus {
	items(): HTMLElement[];
	focus(direction: RovingFocusDirection): void;
	handleArrowKeys(event: KeyboardEvent): boolean;
	restoreAnchorFocus(): Promise<void>;
}

export function createRovingFocus(options: RovingFocusOptions): RovingFocus {
	function items(): HTMLElement[] {
		const container = options.container();
		if (!container) return [];
		return Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE_ITEM_SELECTOR)).filter(
			(item) => item !== container && !item.hasAttribute('disabled'),
		);
	}

	function focus(direction: RovingFocusDirection): void {
		const focusable = items();
		if (focusable.length === 0) return;
		const active = document.activeElement;
		const current = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
		let nextIndex = 0;
		if (direction === 'last' || (direction === 'previous' && current < 0)) {
			nextIndex = focusable.length - 1;
		} else if (direction === 'next' && current >= 0) {
			nextIndex = (current + 1) % focusable.length;
		} else if (direction === 'previous' && current >= 0) {
			nextIndex = (current - 1 + focusable.length) % focusable.length;
		}
		focusable[nextIndex]?.focus({ preventScroll: true });
	}

	function handleArrowKeys(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focus('next');
			return true;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			focus('previous');
			return true;
		}
		if (event.key === 'Home') {
			event.preventDefault();
			focus('first');
			return true;
		}
		if (event.key === 'End') {
			event.preventDefault();
			focus('last');
			return true;
		}
		return false;
	}

	function focusIsOurs(anchor: HTMLElement | null): boolean {
		const active = document.activeElement;
		if (!active || active === document.body) return true;
		return Boolean(options.container()?.contains(active) || anchor?.contains(active));
	}

	async function restoreAnchorFocus(): Promise<void> {
		if (options.restoreFocus && !options.restoreFocus()) return;
		await tick();
		if (options.canRestore && !options.canRestore()) return;
		const anchor = options.anchor?.() ?? null;
		if (!focusIsOurs(anchor)) return;
		if (options.focusReturn?.()) return;
		if (anchor?.isConnected) anchor.focus({ preventScroll: true });
	}

	return { items, focus, handleArrowKeys, restoreAnchorFocus };
}
