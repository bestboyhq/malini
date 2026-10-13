import type { AdoptedAttachment, StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import type { SessionId } from '$lib/chat/domain/session';
import { invoke } from '$shared/port/invoke';

class ComposerAttachmentsService {
	async stageFile(
		workstreamId: string,
		fileName: string,
		file: File,
	): Promise<StagedAgentAttachment> {
		return await this.stageBytes(workstreamId, fileName, await fileToBase64(file));
	}

	stageBytes(
		workstreamId: string,
		fileName: string,
		base64: string,
	): Promise<StagedAgentAttachment> {
		return invoke('chat.stage-attachment-bytes', { workstreamId, fileName, base64 });
	}

	stageForkTranscript(
		workstreamId: string,
		sessionId: SessionId,
		atSeq: number,
	): Promise<StagedAgentAttachment> {
		return invoke('chat.stage-fork-transcript', { workstreamId, sessionId, atSeq });
	}

	adopt(workstreamId: string, attachmentIds: readonly string[]): Promise<AdoptedAttachment[]> {
		return invoke('chat.adopt-attachments', { workstreamId, attachmentIds });
	}

	pickAndStage(workstreamId: string): Promise<StagedAgentAttachment[]> {
		return invoke('chat.pick-and-stage-attachments', { workstreamId });
	}

	renew(workstreamId: string, attachmentIds: readonly string[]): void {
		invoke('chat.renew-staged-attachments', { workstreamId, attachmentIds }).catch(() => {});
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
