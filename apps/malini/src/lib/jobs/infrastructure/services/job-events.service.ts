import type {
	AgentActionRecord,
	JobDefinitionRecord,
	JobExperimentRecord,
	JobRunRecord,
	JobSuggestionRecord,
} from '$contract/jobs';
import {
	JOBS_AGENT_ACTION_CHANGED_CHANNEL,
	JOBS_DEFINITION_CHANGED_CHANNEL,
	JOBS_EXPERIMENT_CHANGED_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_SUGGESTED_CHANNEL,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

interface JobEventHandlers {
	onRunChanged(run: JobRunRecord): void;
	onDefinitionChanged(definitionId: string, definition: JobDefinitionRecord | null): void;
	onSuggested(suggestion: JobSuggestionRecord): void;
	onExperimentChanged(experiment: JobExperimentRecord): void;
	onAgentActionChanged(action: AgentActionRecord): void;
}

class JobEventsService {
	subscribe(handlers: JobEventHandlers): () => void {
		const unlistens = [
			onPlatformEvent(JOBS_RUN_CHANGED_CHANNEL, ({ run }) => handlers.onRunChanged(run)),
			onPlatformEvent(JOBS_DEFINITION_CHANGED_CHANNEL, ({ definitionId, definition }) =>
				handlers.onDefinitionChanged(definitionId, definition),
			),
			onPlatformEvent(JOBS_SUGGESTED_CHANNEL, ({ suggestion }) => handlers.onSuggested(suggestion)),
			onPlatformEvent(JOBS_EXPERIMENT_CHANGED_CHANNEL, ({ experiment }) =>
				handlers.onExperimentChanged(experiment),
			),
			onPlatformEvent(JOBS_AGENT_ACTION_CHANGED_CHANNEL, ({ action }) =>
				handlers.onAgentActionChanged(action),
			),
		];
		return () => {
			for (const unlisten of unlistens) unlisten();
		};
	}
}

export const jobEventsService = new JobEventsService();
