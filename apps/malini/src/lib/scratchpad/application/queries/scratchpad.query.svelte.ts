import type { ScratchpadState } from '$lib/scratchpad/domain/scratchpad';
import { scratchpadsAggregate } from '$lib/scratchpad/infrastructure/aggregates/scratchpads.aggregate.svelte';

export { scratchpadQuery };

class ScratchpadQuery {
	public readonly data: (repositoryFullName: string) => ScratchpadState = $derived(
		(repositoryFullName: string) =>
			scratchpadsAggregate.stateOf(repositoryFullName) ?? { status: 'loading' },
	);
}

const scratchpadQuery = new ScratchpadQuery();
