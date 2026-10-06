import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	globalTopBarGithubStatus,
	type GlobalTopBarGithubStatus,
} from '$shared/shell/global-topbar-actions.svelte';

const OWNER = 'armed-confirmation-spec';

function mergeStatus(onInvoke: () => void): GlobalTopBarGithubStatus {
	return {
		reference: '#42',
		title: 'Land the armed confirmation',
		branch: 'feature/merge → main',
		url: 'https://example.test/pull/42',
		checks: [],
		checksSummary: 'Checks passed',
		review: null,
		todos: null,
		action: {
			label: 'Merge',
			ariaLabel: 'Merge pull request #42',
			tooltip: 'Checks passed. Squash and merge, after one confirming click. Escape cancels it',
			tone: 'primary',
			disabled: false,
			busy: false,
			confirmLabel: 'Confirm merge',
			confirmKey: '#42@head-42',
			onInvoke,
		},
	};
}

type MountedBar = Readonly<{
	action: HTMLButtonElement;
	disclosure: HTMLButtonElement;
	verb: () => string;
	stop: () => void;
}>;

function mountBar(
	onInvoke: () => void,
	status: GlobalTopBarGithubStatus = mergeStatus(onInvoke),
): MountedBar {
	globalTopBarGithubStatus.publish(OWNER, status);
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(TopBar, { target: host, props: {} });
	flushSync();

	const find = (testId: string): HTMLButtonElement => {
		const element = host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
		if (!element) throw new Error(`${testId} is not in the bar`);
		return element;
	};
	const action = find('global-topbar-github-action');

	return {
		action,
		disclosure: find('global-topbar-github-status'),
		verb: () => action.textContent?.trim() ?? '',
		stop: () => {
			void unmount(app, { outro: false });
			host.remove();
		},
	};
}

function arm(bar: MountedBar, merges: () => number): void {
	bar.action.click();
	flushSync();
	expect(bar.verb()).toBe('Confirm merge');
	expect(merges()).toBe(0);
}

function press(key: string): void {
	document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
}

function pointerDownOn(target: EventTarget): void {
	target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
	flushSync();
}

afterEach(() => {
	globalTopBarGithubStatus.clear(OWNER);
	vi.useRealTimers();
});

describe('the armed merge confirmation', () => {
	it('still takes two clicks to merge', () => {
		let merges = 0;
		const bar = mountBar(() => (merges += 1));
		try {
			arm(bar, () => merges);
			bar.action.click();
			flushSync();
			expect(merges).toBe(1);
			expect(bar.verb()).toBe('Merge');
		} finally {
			bar.stop();
		}
	});

	it('disarms on Escape', () => {
		let merges = 0;
		const bar = mountBar(() => (merges += 1));
		try {
			arm(bar, () => merges);
			press('Escape');
			expect(bar.verb()).toBe('Merge');

			bar.action.click();
			flushSync();
			expect(merges).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('disarms when a pointer lands anywhere outside the armed control', () => {
		let merges = 0;
		const bar = mountBar(() => (merges += 1));
		try {
			arm(bar, () => merges);
			pointerDownOn(document.body);
			expect(bar.verb()).toBe('Merge');
			expect(merges).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('stays armed while the human opens the detail beside it', () => {
		let merges = 0;
		const bar = mountBar(() => (merges += 1));
		try {
			arm(bar, () => merges);
			pointerDownOn(bar.disclosure);
			expect(bar.verb()).toBe('Confirm merge');
		} finally {
			bar.stop();
		}
	});

	it('expires on its own rather than waiting indefinitely', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let merges = 0;
		const bar = mountBar(() => (merges += 1));
		try {
			arm(bar, () => merges);

			vi.advanceTimersByTime(9_000);
			flushSync();
			expect(bar.verb()).toBe('Confirm merge');

			vi.advanceTimersByTime(1_500);
			flushSync();
			expect(bar.verb()).toBe('Merge');
			expect(merges).toBe(0);
		} finally {
			bar.stop();
		}
	});
});

describe('an armed detail action', () => {
	function abortStatus(onAbort: () => void): GlobalTopBarGithubStatus {
		return {
			...mergeStatus(() => undefined),
			detailActions: [
				{
					id: 'abort-merge',
					label: 'Abort merge',
					confirmLabel: 'Confirm abort',
					onInvoke: onAbort,
				},
			],
		};
	}

	function openDetail(bar: MountedBar): () => HTMLButtonElement {
		bar.disclosure.click();
		flushSync();
		return () => {
			const element = document.querySelector<HTMLButtonElement>(
				'[data-testid="global-topbar-github-detail-abort-merge"]',
			);
			if (!element) throw new Error('the abort action is not in the open detail');
			return element;
		};
	}

	it('arms on the first click and runs only on the confirming click', () => {
		let aborts = 0;
		const bar = mountBar(
			() => undefined,
			abortStatus(() => (aborts += 1)),
		);
		try {
			const abort = openDetail(bar);
			abort().click();
			flushSync();
			expect(abort().textContent?.trim()).toBe('Confirm abort');
			expect(aborts).toBe(0);

			abort().click();
			flushSync();
			expect(aborts).toBe(1);
		} finally {
			bar.stop();
		}
	});

	it('expires like the merge confirmation', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let aborts = 0;
		const bar = mountBar(
			() => undefined,
			abortStatus(() => (aborts += 1)),
		);
		try {
			const abort = openDetail(bar);
			abort().click();
			flushSync();

			vi.advanceTimersByTime(10_500);
			flushSync();
			expect(abort().textContent?.trim()).toBe('Abort merge');
			expect(aborts).toBe(0);
		} finally {
			bar.stop();
		}
	});
});
