import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';

export { machineMemoryQuery };

class MachineMemoryQuery {
	public readonly data: number = $derived(resourcesAggregate.machineMemoryBytes);
}

const machineMemoryQuery = new MachineMemoryQuery();
