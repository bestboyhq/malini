import type { McpFixStep } from '$lib/chat/domain/mcp-server';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';
import { startMcpFixStepCommand } from './start-mcp-fix-step.command';

export { openMcpFixQueueCommand };

function openMcpFixQueueCommand(workstreamId: string | null, steps: readonly McpFixStep[]): void {
	if (steps.length === 0) return;
	mcpFixQueueStore.open(workstreamId, steps);
	startMcpFixStepCommand();
}
