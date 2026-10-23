import type { McpFixOutcome } from '$lib/chat/domain/mcp-server';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';
import { startMcpFixStepCommand } from './start-mcp-fix-step.command';
import { switchMcpServerCommand } from './switch-mcp-server.command';

export { finishMcpFixStepCommand };

function finishMcpFixStepCommand(outcome: Extract<McpFixOutcome, 'skipped' | 'off'>): void {
	const queue = mcpFixQueueStore.queue;
	const step = queue?.steps[queue.index];
	if (!step) return;
	if (step.fix === 'sign-in' && step.outcome === 'working') {
		void mcpServersService.cancelSignIn(step.server.name).catch(() => undefined);
	}
	if (outcome === 'off') switchMcpServerCommand([step.server.name], step.server.displayName, false);
	mcpFixQueueStore.mark(step.server.name, outcome, null);
	mcpFixQueueStore.advance();
	startMcpFixStepCommand();
}
