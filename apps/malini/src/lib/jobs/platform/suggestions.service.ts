import { randomUUID } from 'node:crypto';
import { CHAT_AGENT_EVENT_CHANNEL, JOBS_SUGGESTED_CHANNEL } from '$contract/events';
import type { JobSuggestedEvent, JobSuggestionRecord } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { insertSuggestionIfAbsent } from './job-suggestions.repository';
import { createTokenSetClusterer, type PromptClusterer } from './prompt-clustering.service';
import { listRecentPrompts } from './prompt-log.repository';

const PROMPT_LOG_WINDOW = 25;

export function suggestJobsFromPrompts(
	{ db, events }: MainContext,
	log: (line: string) => void,
): () => void {
	const clusterer = createTokenSetClusterer();
	return events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (payload) => {
		if (!isPromptSubmitted(payload)) return;
		try {
			for (const suggestion of evaluatePromptLog(db, clusterer)) {
				const suggested: JobSuggestedEvent = { suggestion };
				events.emit(JOBS_SUGGESTED_CHANNEL, suggested);
			}
		} catch (error) {
			log(`jobs: prompt evaluation failed: ${describeError(error)}`);
		}
	});
}

function evaluatePromptLog(db: MaliniDatabase, clusterer: PromptClusterer): JobSuggestionRecord[] {
	return clusterer.cluster(listRecentPrompts(db, PROMPT_LOG_WINDOW)).flatMap((cluster) => {
		const suggestion = insertSuggestionIfAbsent(db, {
			id: randomUUID(),
			clusterKey: cluster.key,
			evidence: cluster.prompts.map(({ text, runId, sessionId, workstreamId, submittedAt }) => ({
				text,
				runId,
				sessionId,
				workstreamId,
				submittedAt,
			})),
			createdAt: nowIso8601(),
		});
		return suggestion ? [suggestion] : [];
	});
}

function isPromptSubmitted(payload: unknown): boolean {
	if (!isRecord(payload)) return false;
	const event = payload['event'];
	if (!isRecord(event) || event['type'] !== 'user.message') return false;
	const sessionId = payload['sessionId'];
	return typeof sessionId === 'string' && sessionId.length > 0;
}
