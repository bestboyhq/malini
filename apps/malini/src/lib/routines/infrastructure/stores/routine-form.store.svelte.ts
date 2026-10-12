import type { RoutineFormSeed } from '$lib/routines/domain/routine-draft';

class RoutineFormStore {
	seed = $state.raw<RoutineFormSeed | null>(null);
}

export const routineFormStore = new RoutineFormStore();
