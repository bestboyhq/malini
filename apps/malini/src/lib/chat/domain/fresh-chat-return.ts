import type { SessionId } from '$lib/chat/domain/session';
import type { SessionRecord } from '$lib/chat/domain/session-record';

export function freshChatReturnSessionId(input: {
	workstreamId: string;
	sessions: readonly SessionRecord[];
	returnSession: SessionRecord | null;
}): SessionId | null {
	if (input.returnSession?.workstreamId === input.workstreamId) return input.returnSession.id;
	const latest = input.sessions
		.filter((session) => session.workstreamId === input.workstreamId)
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
	return latest?.id ?? null;
}
