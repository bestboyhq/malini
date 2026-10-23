import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobSuggestionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-suggestions.aggregate.svelte';
import { jobEventsService } from '$lib/jobs/infrastructure/services/job-events.service';

let watchers = 0;
let unsubscribe: (() => void) | null = null;

export function watchJobsHook(): () => void {
	watchers += 1;
	unsubscribe ??= jobEventsService.subscribe({
		onRunChanged: (run) => jobRunsAggregate.apply(run),
		onDefinitionChanged: (definitionId, definition) => {
			if (definition !== null) {
				jobDefinitionsAggregate.upsert(definition);
				return;
			}
			jobDefinitionsAggregate.remove(definitionId);
			jobRunsAggregate.forgetDefinition(definitionId);
		},
		onSuggested: (suggestion) => jobSuggestionsAggregate.apply(suggestion),
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
