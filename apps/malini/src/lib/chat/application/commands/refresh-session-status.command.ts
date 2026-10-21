import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';

export { refreshSessionStatusCommand };

function refreshSessionStatusCommand(sessionId: SessionId): void {
	void agentSessions.refreshSessionStatus(sessionId).catch(() => undefined);
}
