import type { WorkstreamInstallRecord } from '$shared/repositories/domain/provisioning';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

export { dependencyInstallQuery };

class DependencyInstallQuery {
	public readonly data: (workstreamId: string) => WorkstreamInstallRecord | null = $derived(
		(workstreamId: string) => workstreamDependencyInstall.records[workstreamId] ?? null,
	);
}

const dependencyInstallQuery = new DependencyInstallQuery();
