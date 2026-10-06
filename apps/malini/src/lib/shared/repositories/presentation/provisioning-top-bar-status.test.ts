import { describe, expect, it, vi } from 'vitest';
import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import { provisioningTopBarStatus } from './provisioning-top-bar-status';

function record(failure: string | null): WorkstreamProvisioningRecord {
	return {
		plan: {
			workstreamId: 'ws-a',
			projectId: 'local__rabbits__hutch',
			projectRepoPath: null,
			cloneProgressId: 'rabbits__hutch',
			repoUrl: 'https://github.com/rabbits/hutch.git',
			repositoryFullName: 'rabbits/hutch',
			name: 'Signal Arc',
			branch: 'malini/ws-a',
			baseBranch: 'main',
		},
		phase: 'cloning',
		clonePercent: null,
		failure,
		startedAt: 0,
	};
}

const noActions = { onRetry: (): void => undefined, onRemove: (): void => undefined };

describe('the provisioning top bar status', () => {
	it('stays out of the top bar once setup is done', () => {
		expect(provisioningTopBarStatus(null, false, noActions)).toBeNull();
	});

	it('shows setup in progress as a busy status that cannot be pressed', () => {
		const status = provisioningTopBarStatus(
			{ ...record(null), phase: 'syncing' },
			false,
			noActions,
		);

		expect(status).toMatchObject({
			title: 'Setting up workstream',
			branch: 'malini/ws-a',
			action: {
				label: 'Setting up…',
				ariaLabel: 'Setting up this workstream: Updating main from origin',
				tooltip: 'Updating main from origin. A prompt sent now runs once setup finishes',
				disabled: true,
				busy: true,
			},
		});
		expect(status?.remoteFailure ?? null).toBeNull();
		expect(status?.detailActions ?? []).toEqual([]);
	});

	it('counts the clone up in the top bar while the repository is cloning', () => {
		expect(
			provisioningTopBarStatus({ ...record(null), clonePercent: 42 }, false, noActions)?.action,
		).toMatchObject({
			label: 'Cloning 42%',
			ariaLabel: 'Setting up this workstream: Cloning rabbits/hutch',
		});
	});

	it('offers a retry and a removal for a failed setup', () => {
		const onRetry = vi.fn();
		const onRemove = vi.fn();
		const status = provisioningTopBarStatus(record('disk full'), true, { onRetry, onRemove });

		expect(status).toMatchObject({
			title: 'Workstream setup did not finish',
			branch: 'malini/ws-a',
			remoteFailure: 'disk full',
			action: {
				label: 'Retry setup',
				ariaLabel: 'Retry this workstream’s setup',
				tooltip: 'disk full. Continue this workstream’s setup from where it stopped',
				busy: true,
			},
		});
		expect(status?.detailActions?.map(({ id }) => id)).toEqual(['discard']);

		void status?.action?.onInvoke();
		void status?.detailActions?.[0]?.onInvoke();
		expect(onRetry).toHaveBeenCalledOnce();
		expect(onRemove).toHaveBeenCalledOnce();
	});

	it('tells the user to sign in to GitHub when git could not authenticate', () => {
		const onRetry = vi.fn();
		const status = provisioningTopBarStatus(record('Authentication failed for repo'), true, {
			onRetry,
			onRemove: () => undefined,
		});

		expect(status?.action).toMatchObject({
			ariaLabel: 'Retry this workstream’s setup after signing in to GitHub',
			tooltip:
				'Authentication failed for repo. Sign in with `gh auth login` in a terminal, then retry',
		});
		expect(status?.detailActions).toMatchObject([
			{ id: 'discard', label: 'Remove workstream' },
			{ id: 'retry-setup', label: 'Retry setup', disabled: true },
		]);
		void status?.detailActions?.[1]?.onInvoke();
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('does not repeat a sign-in remedy the failure already names', () => {
		const failure = 'GitHub rejected the credentials. Run `gh auth login` and try again.';
		const status = provisioningTopBarStatus(record(failure), false, noActions);

		expect(status?.action).toMatchObject({
			ariaLabel: 'Retry this workstream’s setup after signing in to GitHub',
			tooltip: `${failure} Then retry this workstream’s setup`,
		});
	});
});
