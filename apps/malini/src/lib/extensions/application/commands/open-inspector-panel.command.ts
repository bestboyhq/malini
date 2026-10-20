import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

export function openInspectorPanelCommand(workstreamId: string, panelId: string): void {
	inspectorPanelCommands.open(workstreamId, panelId);
}
