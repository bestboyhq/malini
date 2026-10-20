import type { Action } from 'svelte/action';

const TAB_INDEX_AFTER_KEY: ReadonlyMap<string, (index: number, count: number) => number> = new Map([
	['ArrowRight', (index: number, count: number): number => (index + 1) % count],
	['ArrowLeft', (index: number, count: number): number => (index - 1 + count) % count],
	['Home', (): number => 0],
	['End', (_index: number, count: number): number => count - 1],
]);

export const roveTabFocus: Action<HTMLElement> = (strip) => {
	function onKeydown(event: KeyboardEvent): void {
		const tab = event.target;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (!(tab instanceof HTMLElement) || tab.getAttribute('role') !== 'tab') return;
		if (event.key === ' ' && tab instanceof HTMLAnchorElement) {
			event.preventDefault();
			tab.click();
			return;
		}
		const indexAfterKey = TAB_INDEX_AFTER_KEY.get(event.key);
		if (!indexAfterKey) return;
		const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')];
		event.preventDefault();
		tabs[indexAfterKey(tabs.indexOf(tab), tabs.length)]?.focus();
	}

	strip.addEventListener('keydown', onKeydown);
	return { destroy: () => strip.removeEventListener('keydown', onKeydown) };
};
