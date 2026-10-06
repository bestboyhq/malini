import { afterEach, describe, expect, it } from 'vitest';
import {
	CHECKPOINTED_CHAT,
	WORKSTREAM,
	callsTo,
	openCheckpointedChat,
	requestId,
	settled,
} from '$lib/chat/application/checkpoint.testkit';
import { forkToNewChatCommand } from '$lib/chat/application/commands/fork-to-new-chat.command';
import { resetPromptPipeline } from '$lib/chat/application/prompt-pipeline.testkit';
import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const NEW_CHAT = agentDraftScopeKey(WORKSTREAM, null);
const PARENT_CHAT = agentDraftScopeKey(WORKSTREAM, CHECKPOINTED_CHAT);

afterEach(async () => {
	agentDrafts.clear(NEW_CHAT);
	agentDrafts.clear(PARENT_CHAT);
	await resetPromptPipeline();
});

function fork(atSeq: number): string {
	const id = requestId();
	forkToNewChatCommand({ requestId: id, atSeq });
	return id;
}

function attachedNames(scope: string): readonly string[] {
	return composerDraftQuery.data(scope).attachments.map((attachment) => attachment.displayName);
}

describe('forking a chat into a new chat', () => {
	it('opens a chat of its own whose composer holds only the transcript up to the run', async () => {
		const { platform } = await openCheckpointedChat();
		updateDraftCommand(NEW_CHAT, { text: 'a draft the fork must not touch' });

		await expect(settled(fork(3))).resolves.toEqual({ status: 'accepted' });

		expect(callsTo(platform, 'chat.stage-fork-transcript')).toEqual([
			{ workstreamId: WORKSTREAM, sessionId: CHECKPOINTED_CHAT, atSeq: 3 },
		]);
		const forked = chatSessionStore.sessionId;
		expect(forked).not.toBeNull();
		expect(forked).not.toBe(CHECKPOINTED_CHAT);
		const forkedChat = agentDraftScopeKey(WORKSTREAM, forked);
		expect(attachedNames(forkedChat)).toEqual([`Transcript of ${CHECKPOINTED_CHAT}.md`]);
		expect(composerDraftQuery.data(forkedChat).text).toBe('');
		expect(attachedNames(NEW_CHAT)).toEqual([]);
		expect(composerDraftQuery.data(NEW_CHAT).text).toBe('a draft the fork must not touch');
		expect(attachedNames(PARENT_CHAT)).toEqual([]);
		expect(callsTo(platform, 'chat.send-prompt')).toEqual([]);
		agentDrafts.clear(forkedChat);
	});

	it('stays on the chat and reports a transcript that could not be staged', async () => {
		const { platform } = await openCheckpointedChat();
		platform.define('chat.stage-fork-transcript', async () => {
			throw new Error('attachments exceed the total limit');
		});

		await expect(settled(fork(3))).resolves.toEqual({
			status: 'failed',
			error: 'attachments exceed the total limit',
		});
		expect(chatSessionStore.sessionId).toBe(CHECKPOINTED_CHAT);
		expect(attachedNames(NEW_CHAT)).toEqual([]);
	});

	it('refuses without a chat to fork from', async () => {
		const { platform } = await openCheckpointedChat();
		chatSessionStore.sessionId = null;

		await expect(settled(fork(3))).resolves.toEqual({
			status: 'failed',
			error: 'Agent session is not ready',
		});
		expect(callsTo(platform, 'chat.stage-fork-transcript')).toEqual([]);
	});
});
