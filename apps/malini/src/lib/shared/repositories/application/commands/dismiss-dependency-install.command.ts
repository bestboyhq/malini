import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

export { dismissDependencyInstallCommand };

function dismissDependencyInstallCommand(workstreamId: string): void {
	workstreamDependencyInstall.clear(workstreamId);
}
