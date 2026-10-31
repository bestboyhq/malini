import type { UsageReport } from '$contract/system';
import type { MaliniDatabase } from '$main/db/driver';
import { listRunFacts } from '$lib/chat/chat.platform';
import {
	listArchivedWorkstreams,
	listWorkstreams,
} from '$shared/repositories/repositories.platform';
import { usageReport } from '../domain/usage-report';

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
	].filter((workstream) => workstream.scope === null);
	const prompts = listRunFacts(db, now.toISOString()).filter(
		(run) => !run.job && !run.automated && !run.lead,
	);
	return usageReport(now, workstreams, prompts);
}
