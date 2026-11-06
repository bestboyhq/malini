import { agentActionsAggregate } from '$lib/automations/infrastructure/aggregates/agent-actions.aggregate.svelte';
import { chatTurnsAggregate } from '$lib/automations/infrastructure/aggregates/chat-turns.aggregate.svelte';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationSuggestionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-suggestions.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';
import { automationEventsService } from '$lib/automations/infrastructure/services/automation-events.service';

let watchers = 0;
let unsubscribe: (() => void) | null = null;

export function watchAutomationsHook(): () => void {
	watchers += 1;
	unsubscribe ??= automationEventsService.subscribe({
		onRunChanged: (run) => automationRunsAggregate.apply(run),
		onDefinitionChanged: (definitionId, definition) => {
			if (definition !== null) {
				automationDefinitionsAggregate.upsert(definition);
				return;
			}
			automationDefinitionsAggregate.remove(definitionId);
			automationRunsAggregate.forgetDefinition(definitionId);
		},
		onSuggested: (suggestion) => automationSuggestionsAggregate.apply(suggestion),
		onExperimentChanged: (experiment) => automationExperimentsAggregate.apply(experiment),
		onAgentActionChanged: (action) => {
			agentActionsAggregate.apply(action);
			const inAutomation = automationRunsAggregate.runs.some(
				(run) => run.sessionId === action.sessionId,
			);
			if (!inAutomation) chatTurnsAggregate.include(action.runId);
		},
		onDecisionChanged: (decision) => reconcilerDecisionsAggregate.apply(decision),
		onChatRunChanged: (runId) => chatTurnsAggregate.refresh(runId),
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
