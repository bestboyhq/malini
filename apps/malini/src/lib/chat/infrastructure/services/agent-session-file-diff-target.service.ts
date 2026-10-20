import type {
	AgentSessionFileDiffRequest,
	AgentSessionFileDiffTarget,
} from '$lib/chat/domain/session-file-diff';
import { OPEN_AGENT_SESSION_DIFF_COMMAND } from '$lib/chat/infrastructure/services/agent-session-changes.service';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

const FILES_PANEL_ID = 'malini.repository.files-panel';

export class AgentSessionFileDiffExtensionTarget implements AgentSessionFileDiffTarget {
	async open(
		workstreamId: string,
		request: AgentSessionFileDiffRequest,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) return;
		if (!extensionCommands.isReadyFor(workstreamId)) {
			throw new Error('The repository extension is not active for this workstream');
		}
		await extensionCommands.execute(workstreamId, OPEN_AGENT_SESSION_DIFF_COMMAND, request);
		if (signal.aborted) return;
		inspectorPanelCommands.open(workstreamId, FILES_PANEL_ID);
	}
}
