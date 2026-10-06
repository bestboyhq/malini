import { publishAutomationRulesCommand } from '$lib/routines/application/commands/publish-automation-rules.command';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routineEventsService } from '$lib/routines/infrastructure/services/routine-events.service';

let watchers = 0;
let unsubscribe: (() => void) | null = null;

export function watchRoutinesHook(): () => void {
	watchers += 1;
	unsubscribe ??= routineEventsService.subscribe({
		onRoutineChanged: (change, routineId, routine) => {
			if (change === 'deleted' || routine === null) routinesAggregate.removeRoutine(routineId);
			else routinesAggregate.upsertRoutine(routine);
			publishAutomationRulesCommand();
		},
		onSuggested: (suggestion) => {
			routinesAggregate.applySuggestion(suggestion);
		},
		onGatedRunChanged: (gatedRun) => {
			routinesAggregate.applyGatedRun(gatedRun);
		},
	});

	let released = false;
	return () => {
		if (released) return;
		released = true;
		watchers -= 1;
		if (watchers > 0) return;
		unsubscribe?.();
		unsubscribe = null;
	};
}
