import type { RoutinesLoadState } from '$lib/routines/domain/routine';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routinesLoadQuery };

class RoutinesLoadQuery {
	public readonly data: Readonly<{ state: RoutinesLoadState; error: string | null }> = $derived({
		state: routinesAggregate.loadState,
		error: routinesAggregate.loadError,
	});
}

const routinesLoadQuery = new RoutinesLoadQuery();
