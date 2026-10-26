import type { AdoptedAttachment, StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import type { SessionId } from '$lib/chat/domain/session';
import { invoke } from '$shared/port/invoke';
import { workstreamNativeExistenceQuery } from '$shared/repositories/repositories.api';

const NO_WORKTREE = 'This workstream has no worktree yet: retry its setup to attach files';

class ComposerAttachmentsService {
	async stageFile(
		workstreamId: string,
		fileName: string,
		file: File,
	): Promise<StagedAgentAttachment> {
		return await this.stageBytes(workstreamId, fileName, await fileToBase64(file));
	}

	async stageBytes(
		workstreamId: string,
		fileName: string,
		base64: string,
	): Promise<StagedAgentAttachment> {
		await untilWorktreeExists(workstreamId);
		return await invoke('chat.stage-attachment-bytes', { workstreamId, fileName, base64 });
	}

	async stageForkTranscript(
		workstreamId: string,
		sessionId: SessionId,
		atSeq: number,
	): Promise<StagedAgentAttachment> {
		await untilWorktreeExists(workstreamId);
		return await invoke('chat.stage-fork-transcript', { workstreamId, sessionId, atSeq });
	}

	async adopt(
		workstreamId: string,
		attachmentIds: readonly string[],
	): Promise<AdoptedAttachment[]> {
		await untilWorktreeExists(workstreamId);
		return await invoke('chat.adopt-attachments', { workstreamId, attachmentIds });
	}

	async pickAndStage(workstreamId: string): Promise<StagedAgentAttachment[]> {
		await untilWorktreeExists(workstreamId);
		return await invoke('chat.pick-and-stage-attachments', { workstreamId });
	}

	renew(workstreamId: string, attachmentIds: readonly string[]): void {
		invoke('chat.renew-staged-attachments', { workstreamId, attachmentIds }).catch(() => {});
	}

	release(workstreamId: string, attachments: readonly StagedAgentAttachment[]): void {
		for (const { id } of attachments) {
			invoke('chat.remove-staged-attachment', { workstreamId, attachmentId: id }).catch(() => {});
		}
	}

	readImage(workstreamId: string, attachmentId: string): Promise<ImageBytes> {
		return invoke('chat.read-staged-attachment', { workstreamId, attachmentId });
	}
}

async function untilWorktreeExists(workstreamId: string): Promise<void> {
	const existence = await new Promise<string>((resolve) => {
		const stop = $effect.root(() => {
			$effect(() => {
				const current = workstreamNativeExistenceQuery.data(workstreamId);
				if (current === 'in-flight') return;
				resolve(current);
				queueMicrotask(stop);
			});
		});
	});
	if (existence === 'absent') throw new Error(NO_WORKTREE);
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
