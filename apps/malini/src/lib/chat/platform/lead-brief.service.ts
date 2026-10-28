import type { MaliniDatabase } from '$main/db/driver';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { leadBrief } from '../domain/lead-brief';
import { listTimelineEventRows } from './events.repository';
import { listLeadDecisions } from './lead-decisions.repository';

export function leadBriefFor(
	db: MaliniDatabase,
	sessionId: string,
	currentRunId: string,
): string | null {
	return leadBrief(
		listTimelineEventRows(db, sessionId, currentRunId),
		listLeadDecisions(db, sessionId),
		(workstreamId) => getWorkstream(db, workstreamId)?.name ?? 'A workstream',
	);
}
