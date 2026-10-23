import { watchMcpServersCommand } from '$lib/chat/application/commands/watch-mcp-servers.command';

export { keepMcpServersWatchedHook };

const RENEW_WATCH_MS = 30_000;

function keepMcpServersWatchedHook(workstreamId: string | null): () => void {
	watchMcpServersCommand(workstreamId);
	const renew = setInterval(() => watchMcpServersCommand(workstreamId), RENEW_WATCH_MS);
	return () => clearInterval(renew);
}
