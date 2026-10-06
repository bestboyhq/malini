// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { pickAttachmentsCommand } from '$lib/chat/application/commands/pick-attachments.command';
import { detachAttachmentCommand } from '$lib/chat/application/commands/detach-attachment.command';
import { forgetChatCommand } from '$lib/chat/application/commands/forget-chat.command';
import { reattachAttachmentsCommand } from '$lib/chat/application/commands/reattach-attachments.command';
import { releaseDetachedAttachmentsCommand } from '$lib/chat/application/commands/release-detached-attachments.command';
import { stageClipboardAttachmentsCommand } from '$lib/chat/application/commands/stage-clipboard-attachments.command';
import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { promptChipMarker } from '$lib/chat/domain/prompt-chip';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

const WORKSTREAM = 'ws-composer';
const SCOPE = agentDraftScopeKey(WORKSTREAM, 's-1');

function attachment(index: number): StagedAgentAttachment {
	const hex = index.toString(16).padStart(32, '0');
	return {
		id: `att-${hex}`,
		displayName: `brief-${index}.pdf`,
		relativePath: `.malini/agent-attachments/att-${hex}/brief-${index}.pdf`,
		mediaType: 'application/pdf',
		size: 42,
		sha256: 'b'.repeat(64),
	};
}

function installPlatform(staged: readonly StagedAgentAttachment[] = []): FakePlatform {
	const platform = createFakePlatform({ stagedAgentAttachments: { [WORKSTREAM]: [...staged] } });
	setPlatformForTest(platform);
	return platform;
}

function draftAttachmentIds(): string[] {
	return composerDraftQuery.data(SCOPE).attachments.map(({ id }) => id);
}

function png(name: string): File {
	return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
}

afterEach(() => {
	agentDrafts.clear(SCOPE);
	chatRequestsStore.reset();
	setPlatformForTest(null);
});

describe('attaching files to the composer draft', () => {
	it('stages pasted files and adds them to the draft', async () => {
		const platform = installPlatform();

		stageClipboardAttachmentsCommand({
			requestId: 'paste',
			workstreamId: WORKSTREAM,
			draftScope: SCOPE,
			files: [{ fileName: 'shot.png', file: png('shot.png') }],
		});

		await expect(chatRequestsStore.settled('paste')).resolves.toEqual({ status: 'accepted' });
		expect(composerDraftQuery.data(SCOPE).attachments).toMatchObject([
			{ displayName: 'shot.png', mediaType: 'image/png' },
		]);
		expect(platform.calls).toEqual([
			{
				command: 'chat.stage-attachment-bytes',
				args: { workstreamId: WORKSTREAM, fileName: 'shot.png', base64: 'iVBORw==' },
			},
		]);
	});

	it('stops staging once the draft holds the most attachments a prompt can carry', async () => {
		const platform = installPlatform();
		updateDraftCommand(SCOPE, {
			attachments: Array.from({ length: 10 }, (_, index) => attachment(index + 1)),
		});

		stageClipboardAttachmentsCommand({
			requestId: 'paste',
			workstreamId: WORKSTREAM,
			draftScope: SCOPE,
			files: [{ fileName: 'shot.png', file: png('shot.png') }],
		});

		await expect(chatRequestsStore.settled('paste')).resolves.toEqual({ status: 'accepted' });
		expect(platform.calls).toEqual([]);
		expect(draftAttachmentIds()).toHaveLength(10);
	});

	it('keeps the draft untouched and reports why a paste could not be staged', async () => {
		installPlatform();

		stageClipboardAttachmentsCommand({
			requestId: 'paste',
			workstreamId: WORKSTREAM,
			draftScope: SCOPE,
			files: [{ fileName: 'archive.zip', file: png('archive.zip') }],
		});

		await expect(chatRequestsStore.settled('paste')).resolves.toEqual({
			status: 'failed',
			error: '`archive.zip` is not a type that can be pasted as an attachment',
		});
		expect(draftAttachmentIds()).toEqual([]);
	});

	it('merges picked files into the draft without duplicating one already attached', async () => {
		installPlatform([attachment(1), attachment(2)]);
		updateDraftCommand(SCOPE, { attachments: [attachment(3), attachment(1)] });

		pickAttachmentsCommand({ requestId: 'pick', workstreamId: WORKSTREAM, draftScope: SCOPE });

		await expect(chatRequestsStore.settled('pick')).resolves.toEqual({ status: 'accepted' });
		expect(draftAttachmentIds()).toEqual([attachment(3).id, attachment(1).id, attachment(2).id]);
	});
});

describe('removing a file chip from the composer draft', () => {
	const marker = (index: number): string =>
		promptChipMarker({ kind: 'attachment', id: attachment(index).id });

	it('keeps the staged file of a removed chip, and undoing the removal attaches it again', () => {
		const platform = installPlatform([attachment(1), attachment(2)]);
		updateDraftCommand(SCOPE, { attachments: [attachment(1), attachment(2)] });

		detachAttachmentCommand({ draftScope: SCOPE, attachmentId: attachment(1).id });
		expect(draftAttachmentIds()).toEqual([attachment(2).id]);

		reattachAttachmentsCommand({ draftScope: SCOPE, prompt: `Read ${marker(1)} ${marker(2)}` });
		expect(draftAttachmentIds()).toEqual([attachment(2).id, attachment(1).id]);
		releaseDetachedAttachmentsCommand({ workstreamId: WORKSTREAM, draftScope: SCOPE });
		expect(platform.calls).toEqual([]);
	});

	it('releases the staged file of a chip still removed when the prompt is sent, once', () => {
		const platform = installPlatform([attachment(1), attachment(2)]);
		updateDraftCommand(SCOPE, { attachments: [attachment(1), attachment(2)] });
		detachAttachmentCommand({ draftScope: SCOPE, attachmentId: attachment(1).id });
		reattachAttachmentsCommand({ draftScope: SCOPE, prompt: `Read ${marker(2)}` });

		releaseDetachedAttachmentsCommand({ workstreamId: WORKSTREAM, draftScope: SCOPE });
		releaseDetachedAttachmentsCommand({ workstreamId: WORKSTREAM, draftScope: SCOPE });

		expect(platform.calls).toEqual([
			{
				command: 'chat.remove-staged-attachment',
				args: { workstreamId: WORKSTREAM, attachmentId: attachment(1).id },
			},
		]);
		expect(draftAttachmentIds()).toEqual([attachment(2).id]);
	});

	it('releases every file a closed chat draft still held, attached or removed', () => {
		const platform = installPlatform([attachment(1), attachment(2)]);
		updateDraftCommand(SCOPE, { attachments: [attachment(1), attachment(2)] });
		detachAttachmentCommand({ draftScope: SCOPE, attachmentId: attachment(1).id });

		forgetChatCommand(WORKSTREAM, 's-1');

		expect(platform.calls.map(({ command, args }) => ({ command, args }))).toEqual([
			{
				command: 'chat.remove-staged-attachment',
				args: { workstreamId: WORKSTREAM, attachmentId: attachment(2).id },
			},
			{
				command: 'chat.remove-staged-attachment',
				args: { workstreamId: WORKSTREAM, attachmentId: attachment(1).id },
			},
		]);
		expect(draftAttachmentIds()).toEqual([]);
	});
});
