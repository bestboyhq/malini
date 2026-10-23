import type { McpServer } from '$lib/chat/domain/mcp-server';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';
import { startMcpFixStepCommand } from './start-mcp-fix-step.command';

export { settleMcpFixStepCommand };

function settleMcpFixStepCommand(server: McpServer): void {
	const queue = mcpFixQueueStore.queue;
	const index = queue?.steps.findIndex((step) => step.server.name === server.name) ?? -1;
	const step = queue?.steps[index];
	if (!queue || !step) return;
	if (server.status === 'connected') {
		mcpFixQueueStore.mark(server.name, 'fixed', null);
		if (index !== queue.index) return;
		mcpFixQueueStore.advance();
		startMcpFixStepCommand();
		return;
	}
	if (step.outcome !== 'working') return;
	mcpFixQueueStore.mark(server.name, 'to-do', server.error ?? stillWaiting(server));
}

function stillWaiting(server: McpServer): string {
	return server.status === 'needs-auth'
		? `${server.displayName} is still not signed in.`
		: `${server.displayName} still does not connect.`;
}
