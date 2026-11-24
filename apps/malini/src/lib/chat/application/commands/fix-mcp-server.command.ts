import { mcpServer, mcpServerDisplayName } from '$lib/chat/domain/mcp-server';
import { openMcpFixQueueCommand } from './open-mcp-fix-queue.command';
import { switchMcpServerCommand } from './switch-mcp-server.command';

export { fixMcpServerCommand };

function fixMcpServerCommand(
	workstreamId: string,
	serverName: string,
	fix: 'sign-in' | 'turn-on',
): void {
	if (fix === 'turn-on') {
		switchMcpServerCommand([serverName], mcpServerDisplayName(serverName), true);
		return;
	}
	const server = mcpServer({ name: serverName, status: 'needs-auth' });
	openMcpFixQueueCommand(workstreamId, [{ server, fix, outcome: 'to-do', error: null }]);
}
