import type { SessionRecord, SessionState } from '$lib/chat/domain/session-record';

export function preferredVisualSessionsByWorkstream(
	sessions: readonly SessionRecord[],
): ReadonlyMap<string, SessionRecord> {
	const preferred = new Map<string, SessionRecord>();
	for (const session of sessions) {
		const current = preferred.get(session.workstreamId);
		if (!current || sessionIsPreferred(session, current)) {
			preferred.set(session.workstreamId, session);
		}
	}
	return preferred;
}

function sessionIsPreferred(candidate: SessionRecord, current: SessionRecord): boolean {
	const candidatePriority = visualSessionPriority(candidate.status);
	const currentPriority = visualSessionPriority(current.status);
	if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
	return candidate.startedAt.localeCompare(current.startedAt) > 0;
}

function visualSessionPriority(status: SessionState): number {
	if (status === 'waiting_for_approval') return 2;
	if (status === 'running') return 1;
	return 0;
}
