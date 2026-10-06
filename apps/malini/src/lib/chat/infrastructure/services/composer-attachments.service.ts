import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import type { SessionId } from '$lib/chat/domain/session';
import { invoke } from '$shared/port/invoke';

class ComposerAttachmentsService {
	async stageFile(
		workstreamId: string,
		fileName: string,
		file: File,
	): Promise<StagedAgentAttachment> {
		return await invoke('chat.stage-attachment-bytes', {
			workstreamId,
			fileName,
			base64: await fileToBase64(file),
		});
	}

	stageForkTranscript(
		workstreamId: string,
		sessionId: SessionId,
		atSeq: number,
	): Promise<StagedAgentAttachment> {
		return invoke('chat.stage-fork-transcript', { workstreamId, sessionId, atSeq });
	}

	pickAndStage(workstreamId: string): Promise<StagedAgentAttachment[]> {
		return invoke('chat.pick-and-stage-attachments', { workstreamId });
	}

	release(workstreamId: string, attachments: readonly StagedAgentAttachment[]): void {
		for (const { id } of attachments) {
			invoke('chat.remove-staged-attachment', { workstreamId, attachmentId: id }).catch(() => {});
		}
	}

	readImage(workstreamId: string, attachmentId: string): Promise<ImageBytes | null> {
		return invoke('chat.read-staged-attachment', { workstreamId, attachmentId });
	}
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error(`could not read \`${file.name}\` from the clipboard`));
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error(`could not read \`${file.name}\` as a data URL`));
				return;
			}
			const separator = result.indexOf(',');
			resolve(separator === -1 ? '' : result.slice(separator + 1));
		};
		reader.readAsDataURL(file);
	});
}

export const composerAttachments = new ComposerAttachmentsService();
