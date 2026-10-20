import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { retryDependencyInstallCommand };

function retryDependencyInstallCommand(workstreamId: string): void {
	workstreamDependencyInstall.report({
		workstreamId,
		status: 'running',
		command: workstreamDependencyInstall.get(workstreamId)?.command ?? null,
	});
	seedWorkstreamDependenciesCommand(workstreamId);
}
