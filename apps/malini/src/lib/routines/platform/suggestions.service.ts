import { randomUUID } from 'node:crypto';
import type { RoutineSuggestionRecord } from '$contract/routines';
import type { MaliniDatabase } from '$main/db/driver';
import type { RoutinePromptClusterer } from './prompt-clustering.service';
import { listRecentPrompts } from './prompt-log.repository';
import { insertSuggestionIfAbsent } from './routines.repository';

export const ROUTINE_PROMPT_LOG_WINDOW = 25;

export function evaluatePromptLog(
	db: MaliniDatabase,
	clusterer: RoutinePromptClusterer,
	options: Readonly<{ limit?: number; now?: () => string }> = {},
): RoutineSuggestionRecord[] {
	const prompts = listRecentPrompts(db, options.limit ?? ROUTINE_PROMPT_LOG_WINDOW);
	const now = options.now ?? (() => new Date().toISOString());
	const created: RoutineSuggestionRecord[] = [];
	for (const cluster of clusterer.cluster(prompts)) {
		const suggestion = insertSuggestionIfAbsent(db, {
			id: randomUUID(),
			clusterKey: cluster.key,
			evidence: cluster.prompts.map((prompt) => ({
				kind: 'prompt' as const,
				text: prompt.text,
				runId: prompt.runId,
				sessionId: prompt.sessionId,
				workstreamId: prompt.workstreamId,
				submittedAt: prompt.submittedAt,
			})),
			createdAt: now(),
		});
		if (suggestion) created.push(suggestion);
	}
	return created;
}
