import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	WORKSTREAM,
	chat,
	completeRun,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
	startRun,
	submission,
	submit,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { pausePromptQueueCommand } from '$lib/chat/application/commands/pause-prompt-queue.command';
import { queuePausedQuery } from '$lib/chat/application/queries/queue-paused.query.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

afterEach(async () => {
	await resetPromptPipeline();
});

async function settleMicrotasks(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe('pausing the prompt queue', () => {
	it('holds queued prompts after the run completes and sends them on resume', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Held' }));
		const sends = recordPromptDelivery();

		pausePromptQueueCommand(WORKSTREAM, true);
		completeRun('s-a1');
		await settleMicrotasks();

		expect(queuePausedQuery.data).toBe(true);
		expect(sends()).toEqual([]);

		pausePromptQueueCommand(WORKSTREAM, false);

		expect(queuePausedQuery.data).toBe(false);
		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ sessionId: 's-a1', prompt: 'Held' })]),
		);
	});

	it('stops draining once the workstream layout lets go of the queue', async () => {
		const { unmount } = await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Held' }));
		const sends = recordPromptDelivery();

		unmount();
		completeRun('s-a1');
		await settleMicrotasks();

		expect(sends()).toEqual([]);
	});
});
