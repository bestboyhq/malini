import type { RoutineFormSeed } from '$lib/routines/domain/routine-draft';
import { routineFormStore } from '$lib/routines/infrastructure/stores/routine-form.store.svelte';

export { routineFormSeedQuery };

class RoutineFormSeedQuery {
	public readonly data: RoutineFormSeed | null = $derived(routineFormStore.seed);
}

const routineFormSeedQuery = new RoutineFormSeedQuery();
