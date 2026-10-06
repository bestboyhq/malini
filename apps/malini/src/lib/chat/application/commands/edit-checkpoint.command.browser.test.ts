import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CHECKPOINT,
	CHECKPOINTED_CHAT,
	WORKSTREAM,
	callsTo,
	openCheckpointedChat,
	outcome,
	requestId,
	settled,
} from '$lib/chat/application/checkpoint.testkit';
import { editCheckpointCommand } from '$lib/chat/application/commands/edit-checkpoint.command';
import {
	recordPromptDelivery,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { checkpoints } from '$lib/chat/infrastructure/services/checkpoint.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { defaultAgentModel, type AgentModel } from '$shared/providers/providers.api';

const OTHER_MODEL: AgentModel = 'claude-opus-5';

afterEach(async () => {
	await resetPromptPipeline();
});

function edit(prompt = 'Write b.txt instead'): string {
	const id = requestId();
	editCheckpointCommand({
		requestId: id,
		checkpointId: CHECKPOINT,
		prompt,
		contextFiles: ['src/b.ts'],
		attachments: [],
		issueReferences: [],
		transcriptReferences: [],
		elementReferences: [],
	});
	return id;
}

describe('editing a message', () => {
	it('restores its checkpoint, then resends the edit to the same chat with the model captured at edit time', async () => {
		const { platform } = await openCheckpointedChat();
		chatModelStore.model = defaultAgentModel();
		chatModelStore.profile = { mode: 'agent', effort: 'high', access: 'sandboxed' };
		const sends = recordPromptDelivery();

		const id = edit();
		chatModelStore.model = OTHER_MODEL;
		chatModelStore.profile = { mode: 'plan', effort: 'low', access: 'sandboxed' };

		expect(outcome(id)).toEqual({ status: 'pending' });
		await expect(settled(id)).resolves.toEqual({ status: 'accepted' });
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([
			{ workstreamId: WORKSTREAM, checkpointId: CHECKPOINT },
		]);
		expect(sends()).toEqual([
			expect.objectContaining({
				sessionId: CHECKPOINTED_CHAT,
				prompt: 'Write b.txt instead',
				contextFiles: ['src/b.ts'],
				profile: { mode: 'agent', effort: 'high', access: 'sandboxed' },
			}),
		]);
	});

	it('does not resend when the chat changed after the restore', async () => {
		await openCheckpointedChat();
		const sends = recordPromptDelivery();
		vi.spyOn(checkpoints, 'rewind').mockImplementation(async () => {
			chatSessionStore.sessionId = 's-a2';
			return true;
		});

		await expect(settled(edit())).resolves.toEqual({
			status: 'failed',
			error: 'Checkpoint restored, but the edit was cancelled because the active chat changed',
		});
		expect(sends()).toEqual([]);
	});

	it('does not restore anything when the restore guard refuses', async () => {
		const { platform } = await openCheckpointedChat();
		const sends = recordPromptDelivery();
		chatSessionStore.setDispatchPending(CHECKPOINTED_CHAT, true);

		await expect(settled(edit())).resolves.toEqual({
			status: 'failed',
			error: 'Wait for the active run to finish before restoring a checkpoint',
		});
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([]);
		expect(sends()).toEqual([]);
	});

	it('fails the edit when the resent prompt is rejected', async () => {
		const { platform } = await openCheckpointedChat();
		platform.define('chat.send-prompt', async () => {
			throw new Error('provider exploded');
		});

		await expect(settled(edit())).resolves.toEqual({
			status: 'failed',
			error: 'provider exploded',
		});
	});

	it('refuses without a selected chat', async () => {
		const { platform } = await openCheckpointedChat();
		chatSessionStore.sessionId = null;

		await expect(settled(edit())).resolves.toEqual({
			status: 'failed',
			error: 'Agent session is not ready',
		});
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([]);
	});
});
