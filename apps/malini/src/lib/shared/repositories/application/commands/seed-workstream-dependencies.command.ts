import { provisioningFailureMessage } from '$shared/repositories/domain/provisioning';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { seedWorkstreamDependenciesCommand };

function seedWorkstreamDependenciesCommand(workstreamId: string): void {
	if (!workstreamDependencyInstall.claimInstall(workstreamId)) return;
	void (async () => {
		try {
			const outcome = await workstreamsService.provisionDependencies(workstreamId);
			workstreamDependencyInstall.settleFromOutcome(workstreamId, outcome);
		} catch (cause) {
			workstreamDependencyInstall.failLocally(workstreamId, provisioningFailureMessage(cause));
		} finally {
			workstreamDependencyInstall.releaseInstall(workstreamId);
		}
	})();
}
