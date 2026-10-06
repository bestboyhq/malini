import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	currentPath,
	gate,
	installRepositoriesPlatform,
	openRoute,
	provisioningPlan,
	resetRepositoriesState,
	stageFailedProvisioning,
	workstream,
} from '$shared/repositories/application/provisioning.testkit';
import { retryProvisioningCommand } from '$shared/repositories/application/commands/retry-provisioning.command';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import WorkstreamProvisioningFrame from './WorkstreamProvisioningFrame.svelte';

type MountedFrame = Readonly<{
	host: HTMLElement;
	find: (testId: string) => HTMLElement | null;
	get: (testId: string) => HTMLElement;
	stop: () => void;
}>;

const mounted: Array<() => void> = [];

afterEach(() => {
	for (const stop of mounted.splice(0)) stop();
	resetRepositoriesState();
});

function mountFrame(workstreamId: string): MountedFrame {
	const host = document.createElement('div');
	document.body.append(host);
	const children = createRawSnippet(() => ({
		render: () => '<button type="button" data-testid="workstream-content">Chat</button>',
	}));
	const app = mount(WorkstreamProvisioningFrame, {
		target: host,
		props: { workstreamId, children },
	});
	flushSync();
	const find = (testId: string): HTMLElement | null =>
		host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	const stop = (): void => {
		void unmount(app, { outro: false });
		host.remove();
	};
	mounted.push(stop);
	return {
		host,
		find,
		get: (testId) => {
			const element = find(testId);
			if (!element) throw new Error(`${testId} is not rendered`);
			return element;
		},
		stop,
	};
}

function isInert(element: HTMLElement): boolean {
	for (let node: HTMLElement | null = element; node; node = node.parentElement) {
		if (node.inert) return true;
	}
	return false;
}

describe('the workstream provisioning frame', () => {
	it('leaves a provisioned workstream interactive and uncovered', () => {
		const frame = mountFrame('ws-ready');

		expect(frame.find('workstream-provisioning-failure')).toBeNull();
		expect(isInert(frame.get('workstream-content'))).toBe(false);
	});

	it('keeps the workstream interactive and uncovered while its setup runs', () => {
		workstreamProvisioning.begin(provisioningPlan('ws-new'));
		const frame = mountFrame('ws-new');

		expect(frame.find('workstream-provisioning-failure')).toBeNull();
		expect(isInert(frame.get('workstream-content'))).toBe(false);

		workstreamProvisioning.advance('ws-new', 'syncing');
		flushSync();

		expect(frame.find('workstream-provisioning-failure')).toBeNull();
		expect(isInert(frame.get('workstream-content'))).toBe(false);
	});

	it('states a failed setup above the workstream without covering it', () => {
		stageFailedProvisioning('ws-failed', 'fatal: could not add worktree');
		const frame = mountFrame('ws-failed');

		const failure = frame.get('workstream-provisioning-failure');
		expect(failure.getAttribute('role')).toBe('alert');
		expect(failure.textContent).toContain(
			'Creating worktree failed, so Signal Arc has no worktree yet',
		);
		expect(frame.get('workstream-provisioning-failure-detail').textContent).toContain(
			'fatal: could not add worktree',
		);
		expect(frame.get('workstream-provisioning-retry').getAttribute('aria-label')).toBe(
			'Retry setting up Signal Arc',
		);
		expect(frame.get('workstream-provisioning-remove').getAttribute('aria-label')).toBe(
			'Remove Signal Arc',
		);
		expect(isInert(frame.get('workstream-content'))).toBe(false);
	});

	it('states an unusable checkout above the workstream, which stays uncovered', async () => {
		installRepositoriesPlatform();
		await workstreamsAggregate.refresh();
		workstreamsAggregate.upsert(
			workstream('ws-gutted', {
				name: 'Copper Circuit',
				checkoutState: 'not-a-checkout',
				checkoutIssue:
					'`/tmp/worktrees/ws-gutted` has no .git entry, so it is not a git checkout any more',
			}),
		);
		const frame = mountFrame('ws-gutted');

		const issue = frame.get('workstream-checkout-issue');
		expect(issue.getAttribute('role')).toBe('alert');
		expect(issue.textContent).toContain(
			'Copper Circuit has no usable checkout, so prompts sent here wait instead of running',
		);
		expect(frame.get('workstream-checkout-issue-detail').textContent).toContain(
			'is not a git checkout any more',
		);
		expect(isInert(frame.get('workstream-content'))).toBe(false);
	});

	it('says nothing about a healthy or merely moved checkout', async () => {
		installRepositoriesPlatform();
		await workstreamsAggregate.refresh();
		workstreamsAggregate.upsert(workstream('ws-healthy', { checkoutState: 'healthy' }));
		workstreamsAggregate.upsert(workstream('ws-moved', { checkoutState: 'path-diverged' }));

		expect(mountFrame('ws-healthy').find('workstream-checkout-issue')).toBeNull();
		expect(mountFrame('ws-moved').find('workstream-checkout-issue')).toBeNull();
	});

	it('retries a failed setup once, even when the top bar asks again', async () => {
		const platform = installRepositoriesPlatform();
		const worktree = gate<string>();
		const createWorkstream = vi.fn(() => worktree.promise);
		platform.define('repositories.create-workstream', createWorkstream);
		stageFailedProvisioning('ws-failed');
		const frame = mountFrame('ws-failed');

		frame.get('workstream-provisioning-retry').click();
		flushSync();

		expect(frame.find('workstream-provisioning-failure')).toBeNull();
		expect(isInert(frame.get('workstream-content'))).toBe(false);
		await vi.waitFor(() => expect(createWorkstream).toHaveBeenCalledTimes(1));

		retryProvisioningCommand('ws-failed');
		await Promise.resolve();
		expect(createWorkstream).toHaveBeenCalledTimes(1);

		worktree.resolve('/tmp/worktrees/ws-failed');

		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-failed')).toBeNull());
		expect(createWorkstream).toHaveBeenCalledTimes(1);
	});

	it('removes a failed workstream and opens the next one', async () => {
		installRepositoriesPlatform();
		workstreamsAggregate.upsert(workstream('ws-next'));
		stageFailedProvisioning('ws-failed');
		await openRoute('/workstreams/ws-failed');
		const frame = mountFrame('ws-failed');

		frame.get('workstream-provisioning-remove').click();
		flushSync();

		expect(frame.find('workstream-provisioning-failure')).toBeNull();
		await vi.waitFor(() => expect(currentPath()).toBe('/workstreams/ws-next'));
	});
});
