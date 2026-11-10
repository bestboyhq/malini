import type { UsageReport } from '$contract/system';
import type { MaliniDatabase } from '$main/db/driver';
import { listRunFacts, type RunFact } from '$lib/chat/chat.platform';
import {
	isRetiredChat,
	listArchivedWorkstreams,
	listWorkstreams,
} from '$shared/repositories/repositories.platform';
import { usageReport } from '../domain/usage-report';

export function isPromptRun(run: RunFact): boolean {
	return !run.automation && !run.automated && !isRetiredChat(run);
}

export function hasPromptRun(db: MaliniDatabase, now: Date): boolean {
	return listRunFacts(db, now.toISOString()).some(isPromptRun);
}

export function readUsageReport(db: MaliniDatabase, now: Date): UsageReport | null {
	const workstreams = [
		...listWorkstreams(db).map((workstream) => ({
			...workstream,
			archivedAt: null,
			merged: false,
		})),
		...listArchivedWorkstreams(db).map((workstream) => ({
			...workstream,
			merged: workstream.mergedPullRequest !== null,
		})),
	].filter((workstream) => !isRetiredChat(workstream));
	const prompts = listRunFacts(db, now.toISOString()).filter(isPromptRun);
	return usageReport(now, workstreams, prompts);
}
