import type { UsageReport } from '$contract/system';
import type { MaliniDatabase } from '$main/db/driver';
import { listRunFacts, type RunFact } from '$lib/chat/chat.platform';
import {
	listArchivedWorkstreams,
	listWorkstreams,
	mergedPullRequestOf,
} from '$shared/repositories/repositories.platform';
import { usageReport, type ReportedWorkstream } from '../domain/usage-report';

export function isPromptRun(run: RunFact): boolean {
	return !run.automation && !run.automated && !run.lead;
}

export function hasPromptRun(db: MaliniDatabase, now: Date): boolean {
	return listRunFacts(db, now.toISOString()).some(isPromptRun);
}

export function userWorkstreams(db: MaliniDatabase): ReportedWorkstream[] {
	return [
		...listWorkstreams(db).map((workstream) => ({
			...workstream,
			archivedAt: null,
			merged: mergedPullRequestOf(db, workstream.id) !== null,
		})),
		...listArchivedWorkstreams(db).map((workstream) => ({
			...workstream,
			merged: workstream.mergedPullRequest !== null,
		})),
	].filter((workstream) => workstream.scope === null);
}

export function readUsageReport(db: MaliniDatabase, now: Date): UsageReport | null {
	const prompts = listRunFacts(db, now.toISOString()).filter(isPromptRun);
	return usageReport(now, userWorkstreams(db), prompts);
}
