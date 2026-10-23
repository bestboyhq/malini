import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';

export { closeMcpFixQueueCommand };

function closeMcpFixQueueCommand(): void {
	const waiting = (mcpFixQueueStore.queue?.steps ?? []).filter(
		(step) => step.fix === 'sign-in' && step.outcome === 'working',
	);
	for (const { server } of waiting) {
		void mcpServersService.cancelSignIn(server.name).catch(() => undefined);
	}
	mcpFixQueueStore.close();
}
