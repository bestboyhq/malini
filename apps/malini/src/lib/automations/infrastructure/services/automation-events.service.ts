import type {
	AgentActionRecord,
	AutomationDefinitionRecord,
	AutomationExperimentRecord,
	AutomationRunRecord,
	AutomationSuggestionRecord,
	ReconcilerDecisionRecord,
} from '$contract/automations';
import {
	CHAT_AGENT_EVENT_CHANNEL,
	AUTOMATIONS_AGENT_ACTION_CHANGED_CHANNEL,
	AUTOMATIONS_DECISION_CHANGED_CHANNEL,
	AUTOMATIONS_DEFINITION_CHANGED_CHANNEL,
	AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_SUGGESTED_CHANNEL,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

interface AutomationEventHandlers {
	onRunChanged(run: AutomationRunRecord): void;
	onDefinitionChanged(definitionId: string, definition: AutomationDefinitionRecord | null): void;
	onSuggested(suggestion: AutomationSuggestionRecord): void;
	onExperimentChanged(experiment: AutomationExperimentRecord): void;
	onAgentActionChanged(action: AgentActionRecord): void;
	onDecisionChanged(decision: ReconcilerDecisionRecord): void;
	onChatRunChanged(runId: string): void;
}

const RUN_EVENTS = new Set(['run.started', 'run.completed', 'run.failed']);

class AutomationEventsService {
	subscribe(handlers: AutomationEventHandlers): () => void {
		const unlistens = [
			onPlatformEvent(AUTOMATIONS_RUN_CHANGED_CHANNEL, ({ run }) => handlers.onRunChanged(run)),
			onPlatformEvent(AUTOMATIONS_DEFINITION_CHANGED_CHANNEL, ({ definitionId, definition }) =>
				handlers.onDefinitionChanged(definitionId, definition),
			),
			onPlatformEvent(AUTOMATIONS_SUGGESTED_CHANNEL, ({ suggestion }) =>
				handlers.onSuggested(suggestion),
			),
			onPlatformEvent(AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL, ({ experiment }) =>
				handlers.onExperimentChanged(experiment),
			),
			onPlatformEvent(AUTOMATIONS_AGENT_ACTION_CHANGED_CHANNEL, ({ action }) =>
				handlers.onAgentActionChanged(action),
			),
			onPlatformEvent(AUTOMATIONS_DECISION_CHANGED_CHANNEL, ({ decision }) =>
				handlers.onDecisionChanged(decision),
			),
			onPlatformEvent(CHAT_AGENT_EVENT_CHANNEL, ({ runId, event }) => {
				if (RUN_EVENTS.has(String(event['type']))) handlers.onChatRunChanged(runId);
			}),
		];
		return () => {
			for (const unlisten of unlistens) unlisten();
		};
	}
}

export const automationEventsService = new AutomationEventsService();
