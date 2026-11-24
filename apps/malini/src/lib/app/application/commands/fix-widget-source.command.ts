import type { WidgetDefinition, WidgetNeed } from '$contract/widgets';
import { fixMcpServerCommand } from '$lib/chat/application/commands/fix-mcp-server.command';
import type { Repository } from '$shared/repositories/repositories.api';
import { startWidgetWorkstreamCommand } from './start-widget-workstream.command';

export { fixWidgetSourceCommand };

function fixWidgetSourceCommand(
	repository: Repository,
	workstreamId: string,
	{ source, title }: WidgetDefinition,
	need: WidgetNeed,
): void {
	if (source.kind !== 'mcp') return;
	if (need !== 'add') {
		fixMcpServerCommand(workstreamId, source.server, need);
		return;
	}
	const where = source.url === null ? '' : ` at ${source.url}`;
	startWidgetWorkstreamCommand(
		repository,
		`Add the ${source.server} MCP server${where} with mcp_servers_add, so my ${title} widget can read its \`${source.tool}\` tool.`,
	);
}
