import {
	ROUTINES_CHANGED_CHANNEL,
	ROUTINES_GATED_RUN_CHANGED_CHANNEL,
	ROUTINES_SUGGESTED_CHANNEL,
} from '$contract/events';
import type { Routine, RoutineChange } from '$lib/routines/domain/routine';
import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { RoutineGatedRunMapper } from '$lib/routines/infrastructure/mappers/routine-gated-run.mapper';
import { RoutineSuggestionMapper } from '$lib/routines/infrastructure/mappers/routine-suggestion.mapper';
import { RoutineMapper } from '$lib/routines/infrastructure/mappers/routine.mapper';
import { onPlatformEvent } from '$shared/port/events';

interface RoutineEventHandlers {
	onRoutineChanged(change: RoutineChange, routineId: string, routine: Routine | null): void;
	onSuggested(suggestion: RoutineSuggestion): void;
	onGatedRunChanged(gatedRun: RoutineGatedRun): void;
}

class RoutineEventsService {
	subscribe(handlers: RoutineEventHandlers): () => void {
		const unlistens = [
			onPlatformEvent(ROUTINES_SUGGESTED_CHANNEL, ({ suggestion }) => {
				handlers.onSuggested(RoutineSuggestionMapper.fromRaw(suggestion));
			}),
			onPlatformEvent(ROUTINES_CHANGED_CHANNEL, ({ change, routineId, routine }) => {
				handlers.onRoutineChanged(
					change,
					routineId,
					routine === null ? null : RoutineMapper.fromRaw(routine),
				);
			}),
			onPlatformEvent(ROUTINES_GATED_RUN_CHANGED_CHANNEL, ({ gatedRun }) => {
				handlers.onGatedRunChanged(RoutineGatedRunMapper.fromRaw(gatedRun));
			}),
		];
		return () => {
			for (const unlisten of unlistens) unlisten();
		};
	}
}

export const routineEventsService = new RoutineEventsService();
