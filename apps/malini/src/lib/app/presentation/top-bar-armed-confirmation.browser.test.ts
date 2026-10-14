import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	globalTopBarGithubStatus,
	type GlobalTopBarGithubStatus,
} from '$shared/shell/global-topbar-actions.svelte';

const OWNER = 'armed-confirmation-spec';

function queueStatus(onQueue: () => void, onCancel: () => void): GlobalTopBarGithubStatus {
	return {
		reference: '#42',
		title: 'Land the queue',
		branch: 'feature/merge → main',
		url: 'https://example.test/pull/42',
		checks: [],
		checksSummary: 'Checks passed',
		review: null,
		todos: null,
		headline: { tone: 'ready', busy: false, label: 'Ready to merge', detail: null, tooltip: null },
		action: {
			label: 'Merge',
			ariaLabel: 'Merge pull request #42',
			tooltip: 'Merge once GitHub allows',
			tone: 'primary',
			icon: 'pr-merged',
			disabled: false,
			onInvoke: onQueue,
		},
		detailActions: [
			{
				id: 'cancel-merge',
				label: 'Cancel merge',
				confirmLabel: 'Confirm cancel',
				onInvoke: onCancel,
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
	it('queues on the first click', () => {
		let queues = 0;
		const bar = mountBar(
			queueStatus(
				() => (queues += 1),
				() => undefined,
			),
		);
		try {
			bar.action.click();
			flushSync();
			expect(queues).toBe(1);
			expect(bar.action.textContent?.trim()).toBe('Merge');
		} finally {
			bar.stop();
		}
	});
});

describe('the top bar Cancel of a queued merge', () => {
	function queuedStatus(onCancel: () => void): GlobalTopBarGithubStatus {
		return {
			...queueStatus(
				() => undefined,
				() => undefined,
			),
			headline: {
				tone: 'queued',
				busy: true,
				label: 'Queued for merge',
				detail: 'Waiting for checks',
				tooltip: null,
			},
			action: {
				label: 'Cancel',
				ariaLabel: 'Cancel the queued merge',
				tooltip: 'Stops the merge queue',
				tone: 'secondary',
				icon: 'close',
				confirmLabel: 'Confirm cancel',
				disabled: false,
				onInvoke: onCancel,
			},
		};
	}

	it('cancels only on the confirming click, and Escape disarms it', () => {
		let cancels = 0;
		const bar = mountBar(queuedStatus(() => (cancels += 1)));
		try {
			bar.action.click();
			flushSync();
			expect(bar.action.textContent?.trim()).toBe('Confirm cancel');
			expect(bar.action.getAttribute('aria-label')).toBe('Confirm cancel');
			expect(cancels).toBe(0);

			press('Escape');
			expect(bar.action.textContent?.trim()).toBe('Cancel');

			bar.action.click();
			flushSync();
			bar.action.click();
			flushSync();
			expect(cancels).toBe(1);
		} finally {
			bar.stop();
		}
	});

	it('reads the status beside the button, never inside it', () => {
		const bar = mountBar(queuedStatus(() => undefined));
		try {
			const status = document.querySelector('[data-testid="global-topbar-github-headline"]');
			expect(status?.getAttribute('role')).toBe('status');
			expect(status?.getAttribute('aria-label')).toBe('Queued for merge · Waiting for checks');
			expect(bar.action.textContent?.trim()).toBe('Cancel');
		} finally {
			bar.stop();
		}
	});
});

describe('an armed detail action', () => {
	type ArmedCancel = Readonly<{
		bar: MountedBar;
		cancel: () => HTMLButtonElement;
		cancels: () => number;
	}>;

	function armCancel(): ArmedCancel {
		let cancels = 0;
		const bar = mountBar(
			queueStatus(
				() => undefined,
				() => (cancels += 1),
			),
		);
		bar.disclosure.click();
		flushSync();
		const cancel = (): HTMLButtonElement => {
			const element = document.querySelector<HTMLButtonElement>(
				'[data-testid="global-topbar-github-detail-cancel-merge"]',
			);
			if (!element) throw new Error('the cancel action is not in the open detail');
			return element;
		};
		cancel().click();
		flushSync();
		expect(cancel().textContent?.trim()).toBe('Confirm cancel');
		expect(cancels).toBe(0);
		return { bar, cancel, cancels: () => cancels };
	}

	it('runs only on the confirming click', () => {
		const { bar, cancel, cancels } = armCancel();
		try {
			cancel().click();
			flushSync();
			expect(cancels()).toBe(1);
		} finally {
			bar.stop();
		}
	});

	it('disarms on Escape', () => {
		const { bar, cancel, cancels } = armCancel();
		try {
			press('Escape');
			expect(cancel().textContent?.trim()).toBe('Cancel merge');
			expect(cancels()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('disarms when a pointer lands outside the armed control', () => {
		const { bar, cancel, cancels } = armCancel();
		try {
			pointerDownOn(document.body);
			expect(cancel().textContent?.trim()).toBe('Cancel merge');
			expect(cancels()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('stays armed through a status publish that rebuilds the same action', () => {
		const { bar, cancel, cancels } = armCancel();
		try {
			globalTopBarGithubStatus.publish(
				OWNER,
				queueStatus(
					() => undefined,
					() => undefined,
				),
			);
			flushSync();
			expect(cancel().textContent?.trim()).toBe('Confirm cancel');
			expect(cancels()).toBe(0);
		} finally {
			bar.stop();
		}
	});

	it('expires on its own rather than waiting indefinitely', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { bar, cancel, cancels } = armCancel();
		try {
			vi.advanceTimersByTime(9_000);
			flushSync();
			expect(cancel().textContent?.trim()).toBe('Confirm cancel');

			vi.advanceTimersByTime(1_500);
			flushSync();
			expect(cancel().textContent?.trim()).toBe('Cancel merge');
			expect(cancels()).toBe(0);
		} finally {
			bar.stop();
		}
	});
});
