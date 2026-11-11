import { isWaitingForUser } from '$contract/agent-state-machine';
import type { SessionRecord, SessionState } from '$lib/chat/domain/session-record';

export function preferredVisualSessionsByWorkstream(
	sessions: readonly SessionRecord[],
): ReadonlyMap<string, SessionRecord> {
	const preferred = new Map<string, SessionRecord>();
	for (const session of sessions) {
		if (session.origin === 'automation') continue;
		const current = preferred.get(session.workstreamId);
		if (!current || sessionIsPreferred(session, current)) {
			preferred.set(session.workstreamId, session);
		}
	}
	return preferred;
}

export function workstreamsRunningAutomations(
	sessions: readonly SessionRecord[],
): ReadonlySet<string> {
	return new Set(
		sessions
			.filter((session) => session.origin === 'automation' && session.status === 'running')
			.map((session) => session.workstreamId),
	);
}

function sessionIsPreferred(candidate: SessionRecord, current: SessionRecord): boolean {
	const candidatePriority = visualSessionPriority(candidate.status);
	const currentPriority = visualSessionPriority(current.status);
	if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
	return candidate.startedAt.localeCompare(current.startedAt) > 0;
}

function visualSessionPriority(status: SessionState): number {
	if (isWaitingForUser(status)) return 2;
	if (status === 'running') return 1;
	return 0;
}
