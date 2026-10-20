import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { createAgentFileMentionOpener } from '$lib/chat/infrastructure/services/agent-file-mention-target.service';

export { openAttachmentFileCommand };

const openRepositoryFile = createAgentFileMentionOpener();

function openAttachmentFileCommand(workstreamId: string, attachment: StagedAgentAttachment): void {
	openRepositoryFile(
		workstreamId,
		{ path: attachment.relativePath, line: null },
		attachment.displayName,
	);
}
