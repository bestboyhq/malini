import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	WORKSTREAM,
	chat,
	holdPromptDelivery,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
	submission,
	submit,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { removeQueuedPromptCommand } from '$lib/chat/application/commands/remove-queued-prompt.command';
import { sendQueuedPromptCommand } from '$lib/chat/application/commands/send-queued-prompt.command';
import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
import { queueErrorsQuery } from '$lib/chat/application/queries/queue-errors.query.svelte';
import { queueSendingQuery } from '$lib/chat/application/queries/queue-sending.query.svelte';
import { queuedPromptsQuery } from '$lib/chat/application/queries/queued-prompts.query.svelte';
import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import type { SessionState } from '$lib/chat/domain/session-record';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';

const INTERRUPTED_RUN_NEVER_FINISHED =
	'The interrupted response never finished. Send this prompt again once the chat is idle.';

afterEach(async () => {
	await resetPromptPipeline();
});

async function queueBehindRunningChat(
	forceFreshSession = false,
): Promise<{ platform: FakePlatform; entry: QueuedPrompt }> {
	const { platform } = await openPromptPipeline([chat('s-a1', { status: 'running' })]);
	rememberChatTurn('s-a1');
	chatSessionStore.sessionId = 's-a1';
	await submit(submission({ sessionId: 's-a1', prompt: 'Send me next', forceFreshSession }));
	const [entry] = agentPromptQueue.entriesFor(WORKSTREAM);
	if (!entry) throw new Error('the prompt was not queued');
	return { platform, entry };
}

async function settleMicrotasks(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function reportChatStatus(sessionId: string, status: SessionState): void {
	const record = sessionsAggregate.getSession(sessionId);
	if (!record) throw new Error(`unknown chat ${sessionId}`);
	sessionsAggregate.hydrateSession({ ...record, sessionId, status });
}

describe('sending a queued prompt now', () => {
	it('sends at once when nothing runs in the workstream', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		agentPromptQueue.setPaused(WORKSTREAM, true);
		const first = agentPromptQueue.enqueue({
			workstreamId: WORKSTREAM,
			targetSessionId: 's-a1',
			prompt: 'First',
			model: 'sonnet',
		});
		const second = agentPromptQueue.enqueue({
			workstreamId: WORKSTREAM,
			targetSessionId: 's-a1',
			prompt: 'Second',
			model: 'sonnet',
		});
		agentPromptQueue.setPaused(WORKSTREAM, false);
		const sends = recordPromptDelivery();

		sendQueuedPromptCommand(second.id);

		await vi.waitFor(() => expect(sends()).toHaveLength(2));
		expect(sends().map((sent) => sent.clientRequestId)).toEqual([second.id, first.id]);
	});

	it('steers the prompt into the running chat without stopping it', async () => {
		const { platform, entry } = await queueBehindRunningChat();
		const sends = recordPromptDelivery();

		sendQueuedPromptCommand(entry.id);

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ sessionId: 's-a1', clientRequestId: entry.id, steer: true }),
			]),
		);
		expect(platform.calls.map(({ command }) => command)).not.toContain('chat.cancel-run');
		await vi.waitFor(() => expect(queueSendingQuery.data).toBeNull());
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]);
	});

	it('moves the prompt into the transcript while it is still being steered in', async () => {
		const { entry } = await queueBehindRunningChat();
		const delivery = holdPromptDelivery();

		sendQueuedPromptCommand(entry.id);

		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Send me next' });
		expect(queuedPromptsQuery.data).toEqual([]);
		delivery.release();
	});

	it('steers again 100 ms later while another prompt is still being handed to the chat', async () => {
		const { entry } = await queueBehindRunningChat();
		const send = vi
			.spyOn(agentSessions, 'sendPrompt')
			.mockRejectedValueOnce(new Error('`s-a1` already has an active run'));
		const sends = () => send.mock.calls.map(([input]) => input);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		sendQueuedPromptCommand(entry.id);
		await settleMicrotasks();
		expect(sends()).toHaveLength(1);
		expect(queueSendingQuery.data).toBe(entry.id);

		await vi.advanceTimersByTimeAsync(100);
		expect(sends()).toEqual([
			expect.objectContaining({ clientRequestId: entry.id, steer: true }),
			expect.objectContaining({ clientRequestId: entry.id, steer: true }),
		]);
		await vi.advanceTimersByTimeAsync(0);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]);
	});

	it('stops the running chat for a prompt meant for a fresh chat, then sends it 100 ms later', async () => {
		const { platform, entry } = await queueBehindRunningChat(true);
		const sends = recordPromptDelivery();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		sendQueuedPromptCommand(entry.id);
		await settleMicrotasks();

		expect(platform.calls).toContainEqual({
			command: 'chat.cancel-run',
			args: { sessionId: 's-a1' },
		});
		expect(queueSendingQuery.data).toBe(entry.id);
		reportChatStatus('s-a1', 'failed');

		await vi.advanceTimersByTimeAsync(99);
		expect(sends()).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ clientRequestId: entry.id })]),
		);
		expect(sends()[0]?.sessionId).not.toBe('s-a1');
		expect(sends()[0]?.steer).toBeUndefined();
		await vi.advanceTimersByTimeAsync(0);
		expect(queueSendingQuery.data).toBeNull();
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]);
	});

	it('keeps retrying every 100 ms for 10 s while the interrupted run lingers, then gives up', async () => {
		const { entry } = await queueBehindRunningChat(true);
		const error = vi.spyOn(toast, 'error');
		const sends = recordPromptDelivery();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		sendQueuedPromptCommand(entry.id);
		await settleMicrotasks();

		await vi.advanceTimersByTimeAsync(100 * 101 - 1);
		expect(queueErrorsQuery.data).toEqual({});
		expect(queueSendingQuery.data).toBe(entry.id);

		await vi.advanceTimersByTimeAsync(1);
		expect(queueErrorsQuery.data).toEqual({ [entry.id]: INTERRUPTED_RUN_NEVER_FINISHED });
		expect(error).not.toHaveBeenCalled();
		expect(queueSendingQuery.data).toBeNull();
		expect(sends()).toEqual([]);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([
			expect.objectContaining({ id: entry.id }),
		]);
		expect(pendingPromptQuery.data('s-a1')).toBeNull();
		expect(queuedPromptsQuery.data.map((queued) => queued.id)).toEqual([entry.id]);
	});

	it('stops retrying when the prompt is removed from the queue', async () => {
		const { entry } = await queueBehindRunningChat(true);
		const sends = recordPromptDelivery();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		sendQueuedPromptCommand(entry.id);
		await settleMicrotasks();
		expect(queueSendingQuery.data).toBe(entry.id);
		removeQueuedPromptCommand(entry.id);

		expect(queueSendingQuery.data).toBeNull();
		reportChatStatus('s-a1', 'completed');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(sends()).toEqual([]);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]);
	});

	it('keeps the prompt queued with the reason when the running chat cannot be stopped', async () => {
		const { platform, entry } = await queueBehindRunningChat(true);
		platform.define('chat.cancel-run', async () => {
			throw new Error('bridge unreachable');
		});
		const error = vi.spyOn(toast, 'error');

		sendQueuedPromptCommand(entry.id);

		await vi.waitFor(() =>
			expect(queueErrorsQuery.data).toEqual({ [entry.id]: 'bridge unreachable' }),
		);
		expect(queueSendingQuery.data).toBeNull();
		expect(error).not.toHaveBeenCalled();
		expect(pendingPromptQuery.data('s-a1')).toBeNull();
		expect(queuedPromptsQuery.data.map((queued) => queued.id)).toEqual([entry.id]);
	});
});
