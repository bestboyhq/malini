import { toast } from '$hyper-ui/components/toast';
import type { FileOpenRequestedPayload } from '$contract/events';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { OPEN_REPOSITORY_FILE_COMMAND } from '$shared/extensions/repository-file';

export async function openRequestedFileCommand({
	workstreamId,
	path,
	line,
}: FileOpenRequestedPayload): Promise<void> {
	try {
		await extensionCommands.execute(workstreamId, OPEN_REPOSITORY_FILE_COMMAND, {
			path,
			line,
			pinned: true,
		});
	} catch {
		toast.error(`Could not open ${path}`, aboutWorkstream(workstreamId));
	}
}
