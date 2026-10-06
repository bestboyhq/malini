import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CHECKPOINTED_CHAT,
	WORKSTREAM,
	callsTo,
	openCheckpointedChat,
	requestId,
	settled,
} from '$lib/chat/application/checkpoint.testkit';
import { navigateChatRoute } from '$lib/chat/application/chat-route.testkit.svelte';
import { redoCheckpointCommand } from '$lib/chat/application/commands/redo-checkpoint.command';
import { resetPromptPipeline } from '$lib/chat/application/prompt-pipeline.testkit';
import { redoFailureOffersBranch } from '$lib/chat/domain/checkpoint-requests';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import type { CommandArgs } from '$contract/commands';

afterEach(async () => {
	await resetPromptPipeline();
});

function redo(restoreSeq = 7): string {
	const id = requestId();
	redoCheckpointCommand({ requestId: id, restoreSeq });
	return id;
}

describe('redoing an undo', () => {
	it('asks the platform to redo the restore of the selected chat, then rehydrates it', async () => {
		const { platform } = await openCheckpointedChat();
		const redoRestore = vi.fn(async (input: CommandArgs<'chat.redo-checkpoint-restore'>) => ({
			sessionId: input.sessionId,
			restoreSeq: input.restoreSeq,
			restoredRunIds: [],
		}));
		platform.define('chat.redo-checkpoint-restore', redoRestore);
		const hydrate = vi.spyOn(agentEventStream, 'hydrate');

		await expect(settled(redo(7))).resolves.toEqual({ status: 'accepted' });

		expect(redoRestore).toHaveBeenCalledWith({
			workstreamId: WORKSTREAM,
			sessionId: CHECKPOINTED_CHAT,
			restoreSeq: 7,
		});
		expect(hydrate).toHaveBeenCalledWith(CHECKPOINTED_CHAT);
	});

	it('falls back to the chat named in the route while the selection is still settling', async () => {
		const { platform } = await openCheckpointedChat();
		chatSessionStore.sessionId = null;
		await navigateChatRoute(`/workstreams/${WORKSTREAM}?agent=${CHECKPOINTED_CHAT}`);
		const redoRestore = vi.fn(async (input: CommandArgs<'chat.redo-checkpoint-restore'>) => ({
			sessionId: input.sessionId,
			restoreSeq: input.restoreSeq,
			restoredRunIds: [],
		}));
		platform.define('chat.redo-checkpoint-restore', redoRestore);

		await expect(settled(redo(3))).resolves.toEqual({ status: 'accepted' });
		expect(redoRestore).toHaveBeenCalledWith({
			workstreamId: WORKSTREAM,
			sessionId: CHECKPOINTED_CHAT,
			restoreSeq: 3,
		});
	});

	it('refuses without any chat to redo in', async () => {
		const { platform } = await openCheckpointedChat();
		chatSessionStore.sessionId = null;

		await expect(settled(redo())).resolves.toEqual({
			status: 'failed',
			error: 'Agent session is not ready',
		});
		expect(callsTo(platform, 'chat.redo-checkpoint-restore')).toEqual([]);
	});

	it('reports a redo the platform can only offer as a branch', async () => {
		const { platform } = await openCheckpointedChat();
		platform.define('chat.redo-checkpoint-restore', async () => {
			throw new Error('the worktree moved on; branch instead');
		});

		const outcome = await settled(redo());

		expect(outcome).toEqual({
			status: 'failed',
			error: 'the worktree moved on; branch instead',
		});
		expect(redoFailureOffersBranch(outcome.status === 'failed' ? outcome.error : null)).toBe(true);
		expect(redoFailureOffersBranch('worktree is locked')).toBe(false);
	});
});
