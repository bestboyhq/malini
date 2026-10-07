import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	globalTopBarGithubStatus,
	type GlobalTopBarGithubStatus,
} from '$shared/shell/global-topbar-actions.svelte';

const OWNER = 'armed-confirmation-spec';

function mergeStatus(onMerge: () => void, onAbort: () => void): GlobalTopBarGithubStatus {
	return {
		reference: '#42',
		title: 'Land the merge',
		branch: 'feature/merge → main',
		url: 'https://example.test/pull/42',
		checks: [],
		checksSummary: 'Checks passed',
		review: null,
		todos: null,
		action: {
			label: 'Merge',
			ariaLabel: 'Merge pull request #42',
			tooltip: 'Checks passed. Squash and merge',
			tone: 'primary',
			disabled: false,
			busy: false,
			onInvoke: onMerge,
		},
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

type MountedBar = Readonly<{
	action: HTMLButtonElement;
	disclosure: HTMLButtonElement;
	stop: () => void;
}>;

function mountBar(status: GlobalTopBarGithubStatus): MountedBar {
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

	return {
		action: find('global-topbar-github-action'),
		disclosure: find('global-topbar-github-status'),
		stop: () => {
			void unmount(app, { outro: false });
			host.remove();
		},
	};
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

describe('the top bar Merge', () => {
	it('merges on the first click', () => {
		let merges = 0;
		const bar = mountBar(
			mergeStatus(
				() => (merges += 1),
				() => undefined,
			),
		);
		try {
			bar.action.click();
			flushSync();
			expect(merges).toBe(1);
			expect(bar.action.textContent?.trim()).toBe('Merge');
		} finally {
			bar.stop();
		}
	});
});

describe('an armed detail action', () => {
	type ArmedAbort = Readonly<{
		bar: MountedBar;
		abort: () => HTMLButtonElement;
		aborts: () => number;
	}>;

	function armAbort(): ArmedAbort {
		let aborts = 0;
		const bar = mountBar(
			mergeStatus(
				() => undefined,
				() => (aborts += 1),
			),
		);
		bar.disclosure.click();
		flushSync();
		const abort = (): HTMLButtonElement => {
			const element = document.querySelector<HTMLButtonElement>(
				'[data-testid="global-topbar-github-detail-abort-merge"]',
			);
			if (!element) throw new Error('the abort action is not in the open detail');
			return element;
		};
		abort().click();
		flushSync();
		expect(abort().textContent?.trim()).toBe('Confirm abort');
		expect(aborts).toBe(0);
		return { bar, abort, aborts: () => aborts };
	}

	it('runs only on the confirming click', () => {
		const { bar, abort, aborts } = armAbort();
		try {
			abort().click();
			flushSync();
			expect(aborts()).toBe(1);
		} finally {
			bar.stop();
		}
	});

	it('disarms on Escape', () => {
		const { bar, abort, aborts } = armAbort();
		try {
			press('Escape');
			expect(abort().textContent?.trim()).toBe('Abort merge');
			expect(aborts()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('disarms when a pointer lands outside the armed control', () => {
		const { bar, abort, aborts } = armAbort();
		try {
			pointerDownOn(document.body);
			expect(abort().textContent?.trim()).toBe('Abort merge');
			expect(aborts()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('stays armed through a status publish that rebuilds the same action', () => {
		const { bar, abort, aborts } = armAbort();
		try {
			globalTopBarGithubStatus.publish(
				OWNER,
				mergeStatus(
					() => undefined,
					() => undefined,
				),
			);
			flushSync();
			expect(abort().textContent?.trim()).toBe('Confirm abort');
			expect(aborts()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('expires on its own rather than waiting indefinitely', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { bar, abort, aborts } = armAbort();
		try {
			vi.advanceTimersByTime(9_000);
			flushSync();
			expect(abort().textContent?.trim()).toBe('Confirm abort');

			vi.advanceTimersByTime(1_500);
			flushSync();
			expect(abort().textContent?.trim()).toBe('Abort merge');
			expect(aborts()).toBe(0);
		} finally {
			bar.stop();
		}
	});
});
