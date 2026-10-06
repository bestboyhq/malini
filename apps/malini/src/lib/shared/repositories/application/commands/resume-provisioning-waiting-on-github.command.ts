import { provisioningFailureIsAuth } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { provisionWorkstreamCommand } from './provision-workstream.command';

export { resumeProvisioningWaitingOnGithubCommand };

function resumeProvisioningWaitingOnGithubCommand(): void {
	for (const record of Object.values(workstreamProvisioning.records)) {
		if (!record.failure || !provisioningFailureIsAuth(record.failure)) continue;
		provisionWorkstreamCommand(record.plan);
	}
}
