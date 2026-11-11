import { extensionCommands } from '$shared/extensions/commands.store.svelte';

export { showChangedFilesCommand };

const SHOW_CHANGED_FILES_COMMAND = 'malini.repository.show-changed-files';

function showChangedFilesCommand(workstreamId: string): void {
	if (!extensionCommands.isReadyFor(workstreamId)) return;
	void extensionCommands.execute(workstreamId, SHOW_CHANGED_FILES_COMMAND).catch(() => undefined);
}
