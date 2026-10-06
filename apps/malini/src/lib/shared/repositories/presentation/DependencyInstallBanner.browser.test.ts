import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallOutcomeStatus } from '$contract/system';
import { QUIET_INSTALL_START_MS } from '$shared/repositories/domain/provisioning';
import {
	gate,
	installRepositoriesPlatform,
	resetRepositoriesState,
} from '$shared/repositories/application/provisioning.testkit';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import DependencyInstallBanner from './DependencyInstallBanner.svelte';

type MountedBanner = Readonly<{
	find: (testId: string) => HTMLElement | null;
	get: (testId: string) => HTMLElement;
}>;

const mounted: Array<() => void> = [];

afterEach(() => {
	vi.useRealTimers();
	for (const stop of mounted.splice(0)) stop();
	resetRepositoriesState();
});

function mountBanner(workstreamId: string): MountedBanner {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(DependencyInstallBanner, { target: host, props: { workstreamId } });
	flushSync();
	mounted.push(() => {
		void unmount(app, { outro: false });
		host.remove();
	});
	const find = (testId: string): HTMLElement | null =>
		host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	return {
		find,
		get: (testId) => {
			const element = find(testId);
			if (!element) throw new Error(`${testId} is not rendered`);
			return element;
		},
	};
}

describe('the dependency install banner', () => {
	it('stays hidden when nothing is installing', () => {
		const banner = mountBanner('ws-a');

		expect(banner.find('workstream-dependency-install')).toBeNull();
	});

	it('announces an install that keeps running, without offering retry or dismiss', () => {
		vi.useFakeTimers();
		workstreamDependencyInstall.report({
			workstreamId: 'ws-a',
			status: 'running',
			command: 'pnpm install',
		});
		const banner = mountBanner('ws-a');

		expect(banner.find('workstream-dependency-install')).toBeNull();
		vi.advanceTimersByTime(QUIET_INSTALL_START_MS - 1);
		flushSync();
		expect(banner.find('workstream-dependency-install')).toBeNull();
		vi.advanceTimersByTime(1);
		flushSync();

		const notice = banner.get('workstream-dependency-install');
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.dataset.installStatus).toBe('running');
		expect(notice.textContent).toContain('Installing dependencies · pnpm install');
		expect(banner.find('workstream-dependency-install-retry')).toBeNull();
		expect(banner.find('workstream-dependency-install-dismiss')).toBeNull();

		workstreamDependencyInstall.report({
			workstreamId: 'ws-a',
			status: 'running',
			command: 'pnpm install --frozen-lockfile',
		});
		flushSync();
		expect(banner.get('workstream-dependency-install').textContent).toContain(
			'Installing dependencies · pnpm install --frozen-lockfile',
		);
	});

	it('never flashes an install that finishes quickly', () => {
		vi.useFakeTimers();
		workstreamDependencyInstall.report({ workstreamId: 'ws-a', status: 'running' });
		const banner = mountBanner('ws-a');

		vi.advanceTimersByTime(QUIET_INSTALL_START_MS / 3);
		flushSync();
		expect(banner.find('workstream-dependency-install')).toBeNull();
		workstreamDependencyInstall.settleFromOutcome('ws-a', 'succeeded');
		vi.advanceTimersByTime(QUIET_INSTALL_START_MS);
		flushSync();

		expect(banner.find('workstream-dependency-install')).toBeNull();
	});

	it('explains an unavailable install and lets the user dismiss it', () => {
		workstreamDependencyInstall.report({
			workstreamId: 'ws-a',
			status: 'skipped',
			reason: 'unrecognized-project',
		});
		const banner = mountBanner('ws-a');

		expect(banner.get('workstream-dependency-install').textContent).toContain(
			'Nothing here says how to install dependencies, so none were installed.',
		);
		expect(banner.find('workstream-dependency-install-retry')).toBeNull();

		banner.get('workstream-dependency-install-dismiss').click();
		flushSync();

		expect(banner.find('workstream-dependency-install')).toBeNull();
	});

	it('explains a failed install and retries it with the same command', async () => {
		const platform = installRepositoriesPlatform();
		const install = gate<InstallOutcomeStatus>();
		const provision = vi.fn((_input: { workstreamId: string }) => install.promise);
		platform.define('repositories.provision-dependencies', provision);
		workstreamDependencyInstall.report({
			workstreamId: 'ws-a',
			status: 'failed',
			command: 'pnpm install',
			detail: 'lockfile is out of date',
		});
		const banner = mountBanner('ws-a');

		expect(banner.get('workstream-dependency-install').textContent).toContain(
			'pnpm install failed · lockfile is out of date',
		);

		banner.get('workstream-dependency-install-retry').click();
		flushSync();

		const notice = banner.get('workstream-dependency-install');
		expect(notice.dataset.installStatus).toBe('running');
		expect(notice.textContent).toContain('Installing dependencies · pnpm install');
		await vi.waitFor(() => expect(provision).toHaveBeenCalledWith({ workstreamId: 'ws-a' }));

		install.resolve('succeeded');

		await vi.waitFor(() => {
			flushSync();
			expect(banner.find('workstream-dependency-install')).toBeNull();
		});
	});

	it('dismisses a failed install', () => {
		workstreamDependencyInstall.report({ workstreamId: 'ws-a', status: 'failed' });
		const banner = mountBanner('ws-a');

		banner.get('workstream-dependency-install-dismiss').click();
		flushSync();

		expect(banner.find('workstream-dependency-install')).toBeNull();
	});
});
