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
import {
	deferred,
	navigateChatRoute,
	type Deferred,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { undoRunCommand } from '$lib/chat/application/commands/undo-run.command';
import { resetPromptPipeline } from '$lib/chat/application/prompt-pipeline.testkit';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';
import { defaultAgentModel } from '$shared/providers/providers.api';

afterEach(async () => {
	await resetPromptPipeline();
});

function queuePrompt(): void {
	agentPromptQueue.enqueue({
		workstreamId: WORKSTREAM,
		targetSessionId: CHECKPOINTED_CHAT,
		prompt: 'Queued behind the undone run',
		model: defaultAgentModel(),
	});
}

function holdCheckpointRestore(platform: FakePlatform): Deferred {
	const restore = deferred();
	const invoke = platform.invoke.bind(platform);
	vi.spyOn(platform, 'invoke').mockImplementation(async (command, args) => {
		if (command === 'chat.restore-checkpoint') await restore.promise;
		return invoke(command, args);
	});
	return restore;
}

function undo(id = requestId()): string {
	undoRunCommand({ requestId: id, runId: 'run-1', checkpointId: CHECKPOINT });
	return id;
}

describe('undoing a run', () => {
	it('restores the checkpoint, clears the chat’s queue, and reopens the same chat', async () => {
		const { platform } = await openCheckpointedChat();
		queuePrompt();
		pendingPromptStore.set({
			sessionId: CHECKPOINTED_CHAT,
			origin: 'composer',
			runId: 'run-pending',
			text: 'optimistic',
			attachments: [],
			issueReferences: [],
		});

		const id = undo();

		expect(outcome(id)).toEqual({ status: 'pending' });
		await expect(settled(id)).resolves.toEqual({ status: 'accepted' });
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([
			{ workstreamId: WORKSTREAM, checkpointId: CHECKPOINT },
		]);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]);
		expect(pendingPromptStore.for(CHECKPOINTED_CHAT)).toBeNull();
		expect(chatSessionStore.sessionId).toBe(CHECKPOINTED_CHAT);
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('refuses without a selected chat and touches nothing', async () => {
		const { platform } = await openCheckpointedChat();
		chatSessionStore.sessionId = null;

		await expect(settled(undo())).resolves.toEqual({
			status: 'failed',
			error: 'Agent session is not ready',
		});
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([]);
	});

	it('refuses while a run is open in the chat', async () => {
		const { platform } = await openCheckpointedChat();
		queuePrompt();
		chatSessionStore.setDispatchPending(CHECKPOINTED_CHAT, true);

		await expect(settled(undo())).resolves.toEqual({
			status: 'failed',
			error: 'Wait for the active run to finish before restoring a checkpoint',
		});
		expect(callsTo(platform, 'chat.restore-checkpoint')).toEqual([]);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toHaveLength(1);
	});

	it('keeps the queue and reports a retry when another chat was selected during the restore', async () => {
		const { platform } = await openCheckpointedChat();
		queuePrompt();
		const restore = holdCheckpointRestore(platform);

		const restart = vi.spyOn(agentEventStream, 'restart');

		const id = undo();
		chatSessionStore.beginSelection(WORKSTREAM, 's-a2');
		chatSessionStore.sessionId = 's-a2';
		restore.resolve();

		await expect(settled(id)).resolves.toEqual({
			status: 'failed',
			error: 'Chat changed while undoing, try again',
		});
		expect(restart).not.toHaveBeenCalled();
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toHaveLength(1);
		expect(chatSessionStore.sessionId).toBe('s-a2');
	});

	it('keeps the queue when another chat was selected while the event stream restarted', async () => {
		await openCheckpointedChat();
		queuePrompt();
		const restarted = deferred();
		const restart = vi.spyOn(agentEventStream, 'restart').mockImplementation(async () => {
			await restarted.promise;
		});

		const id = undo();
		await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
		chatSessionStore.beginSelection(WORKSTREAM, 's-a2');
		chatSessionStore.sessionId = 's-a2';
		restarted.resolve();

		await expect(settled(id)).resolves.toEqual({
			status: 'failed',
			error: 'Chat changed while undoing, try again',
		});
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toHaveLength(1);
	});

	it('keeps the queue when the route leaves the workstream during the restore', async () => {
		const { platform } = await openCheckpointedChat();
		queuePrompt();
		const restore = holdCheckpointRestore(platform);

		const id = undo();
		await navigateChatRoute('/workstreams/ws-b');
		restore.resolve();

		await expect(settled(id)).resolves.toEqual({
			status: 'failed',
			error: 'Chat changed while undoing, try again',
		});
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toHaveLength(1);
	});

	it('reports the platform’s refusal as the undo failure', async () => {
		const { platform } = await openCheckpointedChat();
		platform.define('chat.restore-checkpoint', async () => {
			throw new Error('worktree is locked');
		});

		await expect(settled(undo())).resolves.toEqual({
			status: 'failed',
			error: 'worktree is locked',
		});
	});
});
