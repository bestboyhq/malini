import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';

export { switchMcpServerCommand };

function switchMcpServerCommand(
	serverNames: readonly string[],
	displayName: string,
	on: boolean,
): void {
	const previous = mcpServersAggregate.turnedOff;
	const others = previous.filter((name) => !serverNames.includes(name));
	mcpServersAggregate.replaceTurnedOff(on ? others : [...others, ...serverNames]);
	void (async () => {
		try {
			let turnedOff = previous;
			for (const name of serverNames) turnedOff = await mcpServersService.switchServer(name, on);
			mcpServersAggregate.replaceTurnedOff(turnedOff);
		} catch (error) {
			mcpServersAggregate.replaceTurnedOff(previous);
			void mcpServersAggregate.loadTurnedOff().catch(() => undefined);
			toast.error(
				`Could not turn ${displayName} ${on ? 'on' : 'off'} · ${errorMessage(error, 'unknown error')}`,
			);
		}
	})();
}
