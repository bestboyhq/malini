import type { SessionId } from '$lib/chat/domain/session';

class McpServerActionsStore {
	busy: ReadonlySet<string> = $state.raw(new Set());

	start(sessionId: SessionId, serverName: string): void {
		this.busy = new Set([...this.busy, mcpServerKey(sessionId, serverName)]);
	}

	finish(sessionId: SessionId, serverName: string): void {
		const key = mcpServerKey(sessionId, serverName);
		this.busy = new Set([...this.busy].filter((busy) => busy !== key));
	}
}

export function mcpServerKey(sessionId: SessionId, serverName: string): string {
	return JSON.stringify([sessionId, serverName]);
}

export const mcpServerActionsStore = new McpServerActionsStore();
