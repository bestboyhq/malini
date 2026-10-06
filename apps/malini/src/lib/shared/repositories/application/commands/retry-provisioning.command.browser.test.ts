import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	gate,
	installRepositoriesPlatform,
	resetRepositoriesState,
	stageFailedProvisioning,
} from '$shared/repositories/application/provisioning.testkit';
import { retryProvisioningCommand } from '$shared/repositories/application/commands/retry-provisioning.command';
import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
import { provisioningRetryingQuery } from '$shared/repositories/application/queries/provisioning-retrying.query.svelte';

afterEach(() => {
	resetRepositoriesState();
});

describe('retrying a failed workstream setup', () => {
	it('runs one retry at a time and reports it as retrying until it settles', async () => {
		const platform = installRepositoriesPlatform();
		const worktree = gate<string>();
		const createWorkstream = vi.fn(() => worktree.promise);
		platform.define('repositories.create-workstream', createWorkstream);
		stageFailedProvisioning('ws-failed');

		retryProvisioningCommand('ws-failed');
		retryProvisioningCommand('ws-failed');

		expect(provisioningRetryingQuery.data('ws-failed')).toBe(true);
		await vi.waitFor(() => expect(createWorkstream).toHaveBeenCalledTimes(1));
		retryProvisioningCommand('ws-failed');
		expect(createWorkstream).toHaveBeenCalledTimes(1);

		worktree.resolve('/tmp/worktrees/ws-failed');

		await vi.waitFor(() => expect(provisioningRetryingQuery.data('ws-failed')).toBe(false));
		expect(provisioningRecordQuery.data('ws-failed')).toBeNull();
	});

	it('clears the retrying state when the retry fails again, keeping the failure', async () => {
		const platform = installRepositoriesPlatform();
		platform.define('repositories.create-workstream', async () => {
			throw new Error('worktree path is locked');
		});
		stageFailedProvisioning('ws-failed');

		retryProvisioningCommand('ws-failed');

		await vi.waitFor(() => expect(provisioningRetryingQuery.data('ws-failed')).toBe(false));
		expect(provisioningRecordQuery.data('ws-failed')?.failure).toBe('worktree path is locked');
	});

	it('keeps the retrying state per workstream', async () => {
		const platform = installRepositoriesPlatform();
		const worktree = gate<string>();
		platform.define('repositories.create-workstream', () => worktree.promise);
		stageFailedProvisioning('ws-first');
		stageFailedProvisioning('ws-second');

		retryProvisioningCommand('ws-first');

		expect(provisioningRetryingQuery.data('ws-first')).toBe(true);
		expect(provisioningRetryingQuery.data('ws-second')).toBe(false);
		worktree.resolve('/tmp/worktrees/ws-first');
		await vi.waitFor(() => expect(provisioningRetryingQuery.data('ws-first')).toBe(false));
	});
});
