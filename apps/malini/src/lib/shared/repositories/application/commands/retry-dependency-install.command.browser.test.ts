import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallOutcomeStatus } from '$contract/system';
import {
	gate,
	installRepositoriesPlatform,
	resetRepositoriesState,
} from '$shared/repositories/application/provisioning.testkit';
import { retryDependencyInstallCommand } from '$shared/repositories/application/commands/retry-dependency-install.command';
import { dependencyInstallQuery } from '$shared/repositories/application/queries/dependency-install.query.svelte';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

afterEach(() => {
	resetRepositoriesState();
});

function failedInstall(): void {
	workstreamDependencyInstall.report({
		workstreamId: 'ws-a',
		status: 'failed',
		command: 'pnpm install',
		detail: 'lockfile is out of date',
	});
}

describe('retrying a failed dependency install', () => {
	it('shows the install running with the previous command, then clears it once installed', async () => {
		const platform = installRepositoriesPlatform();
		const install = gate<InstallOutcomeStatus>();
		const provision = vi.fn((_input: { workstreamId: string }) => install.promise);
		platform.define('repositories.provision-dependencies', provision);
		failedInstall();

		retryDependencyInstallCommand('ws-a');

		expect(dependencyInstallQuery.data('ws-a')).toMatchObject({
			status: 'running',
			command: 'pnpm install',
		});
		await vi.waitFor(() => expect(provision).toHaveBeenCalledWith({ workstreamId: 'ws-a' }));

		install.resolve('succeeded');

		await vi.waitFor(() => expect(dependencyInstallQuery.data('ws-a')).toBeNull());
	});

	it('reports the failure again when the install fails', async () => {
		const platform = installRepositoriesPlatform();
		platform.define('repositories.provision-dependencies', () => 'failed');
		failedInstall();

		retryDependencyInstallCommand('ws-a');

		await vi.waitFor(() =>
			expect(dependencyInstallQuery.data('ws-a')).toMatchObject({
				status: 'failed',
				command: 'pnpm install',
			}),
		);
	});
});
