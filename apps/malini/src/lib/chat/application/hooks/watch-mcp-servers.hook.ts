import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { settleMcpFixStepCommand } from '$lib/chat/application/commands/settle-mcp-fix-step.command';

export { watchMcpServersHook };

function watchMcpServersHook(): () => void {
	return mcpServersService.onChanged((server) => {
		mcpServersAggregate.update(server);
		settleMcpFixStepCommand(server);
	});
}
