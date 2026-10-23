import { workstreamSetup } from '$shared/repositories/infrastructure/aggregates/workstream-setup.aggregate.svelte';

export { workstreamSettingUpQuery };

class WorkstreamSettingUpQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		workstreamSetup.isSettingUp(workstreamId),
	);
}

const workstreamSettingUpQuery = new WorkstreamSettingUpQuery();
