import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	globalTopBarGithubStatus,
	type GlobalTopBarGithubStatus,
} from '$shared/shell/global-topbar-actions.svelte';

const OWNER = 'status-placeholder-spec';

function pendingStatus(): GlobalTopBarGithubStatus {
	return {
		reference: null,
		title: null,
		branch: null,
		checks: [],
		checksSummary: '',
		review: null,
		todos: null,
		action: null,
		placeholder: 'Commit and push',
	};
}

let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
});

function renderBar(): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(TopBar, { target: host, props: {} });
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
		globalTopBarGithubStatus.clear(OWNER);
	};
	return host;
}

function rightCluster(host: HTMLElement): HTMLElement {
	const cluster = host.querySelector<HTMLElement>('[data-testid="global-topbar-right"]');
	if (!cluster) throw new Error('the top bar has no right cluster');
	return cluster;
}

describe('the top bar while a workstream status is not known yet', () => {
	it('holds the status place without offering an action or a detail panel', () => {
		globalTopBarGithubStatus.publish(OWNER, pendingStatus());
		const host = renderBar();
		const cluster = rightCluster(host);

		expect(cluster.querySelectorAll('button')).toHaveLength(0);
		expect(cluster.textContent?.trim()).toBe('');
		const placeholder = cluster.querySelector('[data-testid="global-topbar-github-placeholder"]');
		expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
	});

	it('swaps the placeholder for the real action in place once it is known', () => {
		globalTopBarGithubStatus.publish(OWNER, pendingStatus());
		const host = renderBar();

		globalTopBarGithubStatus.publish(OWNER, {
			...pendingStatus(),
			placeholder: null,
			action: {
				label: 'Commit and push',
				ariaLabel: 'Commit and push changes',
				tooltip: 'Commit and push 1 changed file',
				tone: 'primary',
				disabled: false,
				busy: false,
				onInvoke: () => undefined,
			},
		});
		flushSync();

		const cluster = rightCluster(host);
		expect(cluster.querySelector('[data-testid="global-topbar-github-placeholder"]')).toBeNull();
		expect(
			cluster
				.querySelector('[data-testid="global-topbar-github-action"]')
				?.getAttribute('aria-label'),
		).toBe('Commit and push changes');
	});
});
