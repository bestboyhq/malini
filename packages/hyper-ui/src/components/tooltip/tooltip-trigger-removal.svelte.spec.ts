import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import BrowserTab from '../browser-tab/BrowserTab.svelte';

globalThis.ResizeObserver ??= class {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
};

const removeNode = Element.prototype.remove;

function blurFocusedNodeOnRemovalLikeChromium(): void {
	vi.spyOn(Element.prototype, 'remove').mockImplementation(function (this: Element): void {
		const focused = document.activeElement;
		if (focused && this.contains(focused)) {
			focused.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		}
		removeNode.call(this);
	});
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

it('a showing tooltip whose focused trigger is removed hides without a page error', async () => {
	vi.useFakeTimers();
	vi.stubGlobal('matchMedia', () => ({ matches: false }));
	blurFocusedNodeOnRemovalLikeChromium();
	const pageErrors: string[] = [];
	const recordPageError = (event: ErrorEvent): number => pageErrors.push(event.message);
	window.addEventListener('error', recordPageError);
	const host = document.body.appendChild(document.createElement('div'));
	const props: { tooltip: string | undefined } = $state({ tooltip: 'src/alpha.ts' });
	const tab = mount(BrowserTab, {
		target: host,
		props: {
			label: 'alpha.ts',
			selected: true,
			closeLabel: 'Close alpha.ts',
			onclose: () => undefined,
			get tooltip(): string | undefined {
				return props.tooltip;
			},
		},
	});
	flushSync();

	host.querySelector<HTMLElement>('[role="tab"]')?.focus();
	await vi.advanceTimersByTimeAsync(200);
	flushSync();
	expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('src/alpha.ts');

	props.tooltip = undefined;
	flushSync();
	window.removeEventListener('error', recordPageError);
	expect(pageErrors).toEqual([]);
	expect(document.querySelector('[role="tooltip"]')).toBeNull();
	expect(host.querySelector('[role="tab"]')?.textContent).toContain('alpha.ts');
	await unmount(tab);
});
