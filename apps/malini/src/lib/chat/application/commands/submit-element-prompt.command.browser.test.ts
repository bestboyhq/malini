import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserElementPrompt } from '$contract/browser';
import {
	WORKSTREAM,
	chat,
	holdPromptDelivery,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { submitElementPromptCommand } from '$lib/chat/application/commands/submit-element-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const PICKED: BrowserElementPrompt = {
	prompt: 'Make this button primary',
	element: {
		url: 'http://localhost:5173/',
		domPath: 'main > button.save',
		rect: { top: 40, left: 24, width: 96, height: 32 },
		html: '<button class="save">Save</button>',
		source: 'src/App.svelte:12:3',
	},
	screenshot: { mediaType: 'image/png', base64: 'cG5n' },
};

afterEach(async () => {
	await resetPromptPipeline();
});

describe('sending a prompt about a picked element', () => {
	it('reaches the open chat with the element screenshot attached and the element referenced', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const sends = recordPromptDelivery();
		const stage = vi.spyOn(composerAttachments, 'stageBytes');

		submitElementPromptCommand({
			requestId: newChatRequestId(),
			workstreamId: WORKSTREAM,
			picked: PICKED,
		});

		await vi.waitFor(() => expect(sends()).toHaveLength(1));
		expect(stage).toHaveBeenCalledWith(WORKSTREAM, 'element.png', PICKED.screenshot.base64);
		const staged = await stage.mock.results[0]?.value;
		expect(staged).toMatchObject({ displayName: 'element.png', mediaType: 'image/png' });
		expect(sends()[0]).toMatchObject({
			sessionId: 's-a1',
			prompt: 'Make this button primary',
			attachmentIds: [staged?.id],
			elementReferences: [PICKED.element],
		});
	});

	it('keeps the prompt in the composer when the chat refuses it', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const delivery = holdPromptDelivery();

		submitElementPromptCommand({
			requestId: newChatRequestId(),
			workstreamId: WORKSTREAM,
			picked: PICKED,
		});
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		delivery.fail(new Error('Agent runtime unavailable'));

		const scope = agentDraftScopeKey(WORKSTREAM, 's-a1');
		await vi.waitFor(() => expect(agentDrafts.draftFor(scope).text).toBe(PICKED.prompt));
		expect(agentDrafts.draftFor(scope).elementReferences).toEqual([PICKED.element]);
		expect(agentDrafts.draftFor(scope).attachments).toEqual([
			expect.objectContaining({ displayName: 'element.png' }),
		]);
	});
});
