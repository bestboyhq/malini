import { errorMessage } from '$lib/chat/domain/error-message';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';
import { externalUrlService } from '$shared/system/external-url.service';

export { startMcpFixStepCommand };

function startMcpFixStepCommand(): void {
	const queue = mcpFixQueueStore.queue;
	const step = queue?.steps[queue.index];
	if (!queue || !step) return;
	const target = { workstreamId: queue.workstreamId };
	const { name } = step.server;
	mcpFixQueueStore.mark(name, 'working', null);
	void (async () => {
		try {
			if (step.fix === 'sign-in') {
				const authUrl = await mcpServersService.authorize(target, name);
				if (authUrl) await externalUrlService.open(authUrl);
				return;
			}
			await mcpServersService.reconnect(target, name);
		} catch (error) {
			mcpFixQueueStore.mark(name, 'to-do', errorMessage(error, 'unknown error'));
		}
	})();
}
