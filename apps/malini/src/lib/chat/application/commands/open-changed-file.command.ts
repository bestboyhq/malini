import { chatSessionChanges } from '$lib/chat/infrastructure/services/chat-session-changes.service';
import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import type { AgentSessionChangedFile } from '$shared/repositories/repositories.api';

export { openChangedFileCommand };

function openChangedFileCommand(input: {
	workstreamId: string;
	targetSessionId: string | null;
	file: AgentSessionChangedFile;
}): void {
	const changes = sessionChangesStore.changes;
	if (
		!changes ||
		changes.sessionId !== input.targetSessionId ||
		sessionChangesStore.openingPath !== null
	) {
		return;
	}
	const revision = sessionChangesStore.nextOpenRevision();
	sessionChangesStore.openingPath = input.file.path;
	void (async () => {
		try {
			await chatSessionChanges.openChangedFile({
				workstreamId: input.workstreamId,
				changes,
				file: input.file,
			});
		} catch (cause) {
			if (revision !== sessionChangesStore.openRevision) return;
			toast.error(
				`Could not open agent chat diff · ${cause instanceof Error ? cause.message : String(cause)}`,
				aboutWorkstream(input.workstreamId),
			);
		} finally {
			if (revision === sessionChangesStore.openRevision) sessionChangesStore.openingPath = null;
		}
	})();
}
