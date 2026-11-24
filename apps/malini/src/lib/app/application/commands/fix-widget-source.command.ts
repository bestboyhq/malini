import type { WidgetDefinition, WidgetNeed } from '$contract/widgets';
import { fixMcpServerCommand } from '$lib/chat/application/commands/fix-mcp-server.command';
import { shipPromptCommand } from '$lib/chat/application/commands/ship-prompt.command';

export { fixWidgetSourceCommand };

function fixWidgetSourceCommand(
	workstreamId: string,
	{ source, title }: WidgetDefinition,
	need: WidgetNeed,
	inNewChat: boolean,
): void {
	if (source.kind !== 'mcp') return;
	if (need !== 'add') {
		fixMcpServerCommand(workstreamId, source.server, need);
		return;
	}
	const where = source.url === null ? '' : ` at ${source.url}`;
	shipPromptCommand({
		workstreamId,
		prompt: `Add the ${source.server} MCP server${where} with mcp_servers_add, so my ${title} widget can read its \`${source.tool}\` tool.`,
		subject: 'Widget',
		inNewChat,
	});
}
