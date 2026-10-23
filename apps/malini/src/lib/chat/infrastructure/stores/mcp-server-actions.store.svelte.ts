import type { McpServerTarget } from '$contract/mcp-servers';

class McpServerActionsStore {
	busy: ReadonlySet<string> = $state.raw(new Set());

	start(target: McpServerTarget, serverName: string): void {
		this.busy = new Set([...this.busy, mcpServerKey(target, serverName)]);
	}

	finish(target: McpServerTarget, serverName: string): void {
		const key = mcpServerKey(target, serverName);
		this.busy = new Set([...this.busy].filter((busy) => busy !== key));
	}
}

export function mcpServerKey(target: McpServerTarget, serverName: string): string {
	return JSON.stringify([
		'sessionId' in target ? target.sessionId : target.workstreamId,
		serverName,
	]);
}

export const mcpServerActionsStore = new McpServerActionsStore();
