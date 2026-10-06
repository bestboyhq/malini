import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	navigationHistoryTargetLedger,
	HISTORY_INDEX_KEY,
	NAVIGATION_INDEX_KEY,
} from '$shared/router/history-ledger';
import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';
import { sidebarPresenceStore } from '$lib/app/infrastructure/stores/sidebar-presence.store.svelte';

function entryState(index: number): Record<string, number> {
	return {
		[HISTORY_INDEX_KEY]: index,
		[NAVIGATION_INDEX_KEY]: index,
	};
}

type MountedBar = Readonly<{
	toggle: HTMLButtonElement;
	connectRepository: HTMLAnchorElement;
	back: HTMLButtonElement;
	forward: HTMLButtonElement;
	stop: () => void;
}>;

function mountBar(): MountedBar {
	const leaveSidebar = sidebarPresenceStore.enter();
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(TopBar, { target: host, props: {} });
	flushSync();

	const find = <T extends HTMLElement = HTMLButtonElement>(testId: string): T => {
		const element = host.querySelector<T>(`[data-testid="${testId}"]`);
		if (!element) throw new Error(`${testId} is not in the bar`);
		return element;
	};

	return {
		toggle: find('global-topbar-sidebar-toggle'),
		connectRepository: find<HTMLAnchorElement>('global-topbar-connect-repository'),
		back: find('global-topbar-history-back'),
		forward: find('global-topbar-history-forward'),
		stop: () => {
			void unmount(app, { outro: false });
			host.remove();
			leaveSidebar();
		},
	};
}

describe('the titlebar on a route without a sidebar', () => {
	it('drops the toggle and tucks the arrows in, since there is no edge to rest against', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const app = mount(TopBar, { target: host, props: {} });
		flushSync();
		try {
			expect(host.querySelector('[data-testid="global-topbar-sidebar-toggle"]')).toBeNull();
			expect(
				host
					.querySelector('[data-testid="global-topbar-left"]')
					?.classList.contains('topbar-left--collapsed'),
			).toBe(true);
			expect(host.querySelector('[data-testid="global-topbar-history-back"]')).not.toBeNull();
		} finally {
			void unmount(app, { outro: false });
			host.remove();
		}
	});
});

afterEach(() => {
	navigationHistoryTargetLedger.reset();
	history.replaceState(null, '', '#/');
	vi.restoreAllMocks();
});

describe('the titlebar history arrows', () => {
	it('disables back at index zero and forward without a known adjacent entry', () => {
		history.replaceState(entryState(0), '', '#/');
		const bar = mountBar();
		try {
			expect(bar.back.disabled).toBe(true);
			expect(bar.forward.disabled).toBe(true);
		} finally {
			bar.stop();
		}
	});

	it('invokes history.back when there is an entry behind the current one', () => {
		history.replaceState(entryState(2), '', '#/two');
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const bar = mountBar();
		try {
			expect(bar.back.disabled).toBe(false);
			bar.back.click();
			flushSync();
			expect(back).toHaveBeenCalledTimes(1);
		} finally {
			bar.stop();
		}
	});

	it('invokes history.forward only when the ledger predicts the adjacent entry', () => {
		history.replaceState(entryState(1), '', '#/one');
		navigationHistoryTargetLedger.observeEntry(entryState(2), '/two');
		const forward = vi.spyOn(history, 'forward').mockImplementation(() => undefined);
		const bar = mountBar();
		try {
			expect(bar.forward.disabled).toBe(false);
			bar.forward.click();
			flushSync();
			expect(forward).toHaveBeenCalledTimes(1);
		} finally {
			bar.stop();
		}
	});
});

describe('the titlebar sidebar toggle', () => {
	it('flips the shared collapsed state and renames itself for the new direction', () => {
		const bar = mountBar();
		const initial = sidebarCollapsedStore.current;
		try {
			bar.toggle.click();
			flushSync();
			expect(sidebarCollapsedStore.current).toBe(!initial);
			expect(bar.toggle.getAttribute('aria-label')).toBe(
				sidebarCollapsedStore.current ? 'Show sidebar' : 'Hide sidebar',
			);

			bar.toggle.click();
			flushSync();
			expect(sidebarCollapsedStore.current).toBe(initial);
		} finally {
			bar.stop();
		}
	});
});

describe('the titlebar connect repository control', () => {
	it('is an anchor to the repositories list, placed left of the back arrow', () => {
		const bar = mountBar();
		try {
			expect(bar.connectRepository.tagName).toBe('A');
			expect(bar.connectRepository.getAttribute('href')).toBe('/');
			expect(bar.connectRepository.getAttribute('aria-label')).toBe('Connect repository');
			expect(bar.connectRepository.closest('.topbar-history')).not.toBeNull();
			expect(
				bar.connectRepository.compareDocumentPosition(bar.back) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		} finally {
			bar.stop();
		}
	});
});
