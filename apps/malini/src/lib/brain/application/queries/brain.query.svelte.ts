import type { BrainEntry, BrainStatus } from '$contract/brain';
import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';

export { brainQuery };

class BrainQuery {
	public readonly data: Readonly<{
		status: BrainStatus | null;
		entries: readonly BrainEntry[] | null;
		settingUp: boolean;
		syncing: boolean;
	}> = $derived({
		status: brainAggregate.status,
		entries: brainAggregate.entries,
		settingUp: brainAggregate.settingUp,
		syncing: brainAggregate.syncing,
	});
}

const brainQuery = new BrainQuery();
