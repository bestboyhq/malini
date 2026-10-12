import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
import { JOBS_DEFINITION_CHANGED_CHANNEL, JOBS_RUN_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

interface JobEventHandlers {
	onRunChanged(run: JobRunRecord): void;
	onDefinitionChanged(definitionId: string, definition: JobDefinitionRecord | null): void;
}

class JobEventsService {
	subscribe(handlers: JobEventHandlers): () => void {
		const unlistens = [
			onPlatformEvent(JOBS_RUN_CHANGED_CHANNEL, ({ run }) => handlers.onRunChanged(run)),
			onPlatformEvent(JOBS_DEFINITION_CHANGED_CHANNEL, ({ definitionId, definition }) =>
				handlers.onDefinitionChanged(definitionId, definition),
			),
		];
		return () => {
			for (const unlisten of unlistens) unlisten();
		};
	}
}

export const jobEventsService = new JobEventsService();
