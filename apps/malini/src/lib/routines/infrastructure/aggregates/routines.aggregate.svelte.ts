import type { Routine, RoutinesLoadState, RoutineStatus } from '$lib/routines/domain/routine';
import { sortRoutinesOldestFirst } from '$lib/routines/domain/routine';
import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
import { sortGatedRunsOldestFirst } from '$lib/routines/domain/routine-gated-run';
import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { sortSuggestionsNewestFirst } from '$lib/routines/domain/routine-suggestion';
import { routineGateService } from '$lib/routines/infrastructure/services/routine-gate.service';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';

class RoutinesAggregate {
	routines = $state.raw<readonly Routine[]>([]);
	suggestions = $state.raw<readonly RoutineSuggestion[]>([]);
	pendingGatedRuns = $state.raw<readonly RoutineGatedRun[]>([]);
	loadState = $state<RoutinesLoadState>('idle');
	loadError = $state<string | null>(null);

	#generation = 0;

	routinesWithStatus(status: RoutineStatus): readonly Routine[] {
		return this.routines.filter((routine) => routine.status === status);
	}

	gatedRunsFor(routineId: string): readonly RoutineGatedRun[] {
		return this.pendingGatedRuns.filter((gatedRun) => gatedRun.routineId === routineId);
	}

	async load(): Promise<void> {
		const generation = ++this.#generation;
		if (this.loadState !== 'ready') this.loadState = 'loading';
		try {
			const [routines, suggestions, gatedRuns] = await Promise.all([
				routinesService.list(),
				routinesService.listSuggestions(),
				routineGateService.listPending(),
			]);
			if (generation !== this.#generation) return;
			this.routines = sortRoutinesOldestFirst(routines);
			this.suggestions = sortSuggestionsNewestFirst(
				suggestions.filter((suggestion) => suggestion.status === 'open'),
			);
			this.pendingGatedRuns = sortGatedRunsOldestFirst(
				gatedRuns.filter((gatedRun) => gatedRun.state === 'pending'),
			);
			this.loadState = 'ready';
			this.loadError = null;
		} catch (error) {
			if (generation !== this.#generation) return;
			this.loadState = 'error';
			this.loadError = errorMessage(error);
		}
	}

	upsertRoutine(routine: Routine): void {
		this.routines = sortRoutinesOldestFirst([
			...this.routines.filter((existing) => existing.id !== routine.id),
			routine,
		]);
	}

	removeRoutine(routineId: string): void {
		this.routines = this.routines.filter((routine) => routine.id !== routineId);
		this.pendingGatedRuns = this.pendingGatedRuns.filter(
			(gatedRun) => gatedRun.routineId !== routineId,
		);
	}

	applySuggestion(suggestion: RoutineSuggestion): void {
		if (suggestion.status !== 'open') {
			this.removeSuggestion(suggestion.id);
			return;
		}
		this.suggestions = sortSuggestionsNewestFirst([
			...this.suggestions.filter((existing) => existing.id !== suggestion.id),
			suggestion,
		]);
	}

	removeSuggestion(suggestionId: string): void {
		this.suggestions = this.suggestions.filter((suggestion) => suggestion.id !== suggestionId);
	}

	applyGatedRun(gatedRun: RoutineGatedRun): void {
		if (gatedRun.state !== 'pending') {
			this.pendingGatedRuns = this.pendingGatedRuns.filter(
				(existing) => existing.id !== gatedRun.id,
			);
			return;
		}
		this.pendingGatedRuns = sortGatedRunsOldestFirst([
			...this.pendingGatedRuns.filter((existing) => existing.id !== gatedRun.id),
			gatedRun,
		]);
	}
}

export const routinesAggregate = new RoutinesAggregate();

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
