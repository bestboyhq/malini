import { afterEach, describe, expect, it } from 'vitest';
import { resetRepositoriesState } from '$shared/repositories/application/provisioning.testkit';
import { dismissDependencyInstallCommand } from '$shared/repositories/application/commands/dismiss-dependency-install.command';
import { dependencyInstallQuery } from '$shared/repositories/application/queries/dependency-install.query.svelte';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

afterEach(() => {
	resetRepositoriesState();
});

describe('dismissing a dependency install notice', () => {
	it('hides the notice of that workstream only', () => {
		workstreamDependencyInstall.report({ workstreamId: 'ws-a', status: 'failed' });
		workstreamDependencyInstall.report({ workstreamId: 'ws-b', status: 'failed' });
		expect(dependencyInstallQuery.data('ws-a')?.status).toBe('failed');

		dismissDependencyInstallCommand('ws-a');

		expect(dependencyInstallQuery.data('ws-a')).toBeNull();
		expect(dependencyInstallQuery.data('ws-b')?.status).toBe('failed');
	});
});
