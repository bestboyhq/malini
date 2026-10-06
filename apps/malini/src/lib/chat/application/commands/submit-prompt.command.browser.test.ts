import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	SIBLING_WORKSTREAM,
	WORKSTREAM,
	chat,
	completeRun,
	holdPromptDelivery,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
	startRun,
	submission,
	submit,
	submitAndSettle,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { selectModelCommand } from '$lib/chat/application/commands/select-model.command';
import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
import { chatRunningQuery } from '$lib/chat/application/queries/chat-running.query.svelte';
import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
import { queueErrorsQuery } from '$lib/chat/application/queries/queue-errors.query.svelte';
import { queuedPromptsQuery } from '$lib/chat/application/queries/queued-prompts.query.svelte';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { defaultAgentModel, type AgentModel } from '$shared/providers/providers.api';

const OTHER_MODEL: AgentModel = 'claude-opus-5';

afterEach(async () => {
	await resetPromptPipeline();
});

function queuedPrompts(workstreamId = WORKSTREAM): readonly string[] {
	return agentPromptQueue.entriesFor(workstreamId).map((entry) => entry.prompt);
}

describe('submitting a prompt to an idle chat', () => {
	it('shows the prompt in the transcript before any await, then clears it once the run starts', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const delivery = holdPromptDelivery();

		const settled = submitAndSettle(submission({ sessionId: 's-a1' }));

		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Ship the fix' });
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Ship the fix' });
		expect(chatRunningQuery.data).toBe(true);

		delivery.release();
		await expect(settled).resolves.toEqual({ status: 'accepted' });
		await vi.waitFor(() => expect(pendingPromptQuery.data('s-a1')).toBeNull());
		expect(delivery.calls()[0]).toMatchObject({ sessionId: 's-a1', prompt: 'Ship the fix' });
	});

	it('shows the prompt of a fresh chat while the provider has not accepted it yet', async () => {
		await openPromptPipeline([]);
		const delivery = holdPromptDelivery();

		const sent = submit(submission());

		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		const minted = delivery.calls()[0]?.sessionId ?? '';
		expect(minted).not.toBe('');
		expect(chatSessionStore.sessionId).toBe(minted);
		expect(pendingPromptQuery.data(minted)).toMatchObject({ text: 'Ship the fix' });

		delivery.release();
		await sent;
	});
});

describe('submitting while a run is active', () => {
	it('queues the prompt for the captured chat and sends it when that run completes', async () => {
		await openPromptPipeline([
			chat('s-a1'),
			chat('s-a2', { startedAt: '2026-01-02T00:00:00.000Z' }),
		]);
		rememberChatTurn('s-a1');
		rememberChatTurn('s-a2');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1', prompt: 'Next step' }));

		const [entry] = agentPromptQueue.entriesFor(WORKSTREAM);
		expect(entry).toMatchObject({ prompt: 'Next step', targetSessionId: 's-a1' });
		expect(queuedPromptsQuery.data.map((queued) => queued.prompt)).toEqual(['Next step']);
		await Promise.resolve();
		expect(sends()).toEqual([]);

		completeRun('s-a1');

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({
					sessionId: 's-a1',
					prompt: 'Next step',
					clientRequestId: entry?.id,
				}),
			]),
		);
		await vi.waitFor(() => expect(queuedPrompts()).toEqual([]));
	});

	it('moves a queued prompt from the queue into the transcript in one step', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Next step' }));
		expect(queuedPromptsQuery.data.map((queued) => queued.prompt)).toEqual(['Next step']);
		const delivery = holdPromptDelivery();

		completeRun('s-a1');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));

		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Next step' });
		expect(queuedPromptsQuery.data).toEqual([]);
		expect(workstreamChatSummaryQuery.data(WORKSTREAM).queueCount).toBe(0);

		delivery.release();
		await vi.waitFor(() => expect(queuedPrompts()).toEqual([]));
	});

	it('keeps the prompt being sent here on screen while another workstream’s queue sends', async () => {
		await openPromptPipeline([chat('s-a1'), chat('s-b1', { workstreamId: SIBLING_WORKSTREAM })]);
		rememberChatTurn('s-a1');
		rememberChatTurn('s-b1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-b1');
		await submit(
			submission({
				workstreamId: SIBLING_WORKSTREAM,
				sessionId: 's-b1',
				prompt: 'Background next',
			}),
		);
		const delivery = holdPromptDelivery();
		const foreground = submitAndSettle(submission({ sessionId: 's-a1', prompt: 'Foreground' }));
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));

		completeRun('s-b1');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(2));

		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Foreground' });
		expect(pendingPromptQuery.data('s-b1')).toMatchObject({ text: 'Background next' });
		delivery.release();
		await foreground;
	});

	it('keeps a queued prompt handed off while the runtime briefly reports the chat as still busy', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Next step' }));
		const deliver = agentSessions.sendPrompt.bind(agentSessions);
		let attempts = 0;
		vi.spyOn(agentSessions, 'sendPrompt').mockImplementation(async (input) => {
			attempts += 1;
			if (attempts === 1) throw new Error('Session s-a1 already has an active run');
			return deliver(input);
		});

		completeRun('s-a1');
		await vi.waitFor(() => expect(attempts).toBe(1));
		await Promise.resolve();

		expect(queuedPromptsQuery.data).toEqual([]);
		expect(pendingPromptQuery.data('s-a1')).toMatchObject({ text: 'Next step' });
		await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 3_000 });
		await vi.waitFor(() => expect(queuedPrompts()).toEqual([]));
	});

	it('puts a queued prompt back in the queue when its delivery fails', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Next step' }));
		const delivery = holdPromptDelivery();
		completeRun('s-a1');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));

		delivery.fail(new Error('provider exploded'));

		await vi.waitFor(() =>
			expect(queuedPromptsQuery.data.map((queued) => queued.prompt)).toEqual(['Next step']),
		);
		expect(pendingPromptQuery.data('s-a1')).toBeNull();
	});

	it('starts a fresh chat for a queued turn whose model differs from the turn before it', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');

		await submit(submission({ sessionId: 's-a1', prompt: 'Same model' }));
		await submit(submission({ sessionId: 's-a1', prompt: 'Other model', model: OTHER_MODEL }));

		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([
			expect.objectContaining({
				prompt: 'Same model',
				targetSessionId: 's-a1',
				forceFreshSession: false,
			}),
			expect.objectContaining({
				prompt: 'Other model',
				targetSessionId: 's-a1',
				forceFreshSession: true,
			}),
		]);
	});

	it('queues behind a sibling run instead of starting a second run in the workstream', async () => {
		await openPromptPipeline([chat('s-a1'), chat('s-a2', { status: 'running' })]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1' }));

		expect(sends()).toEqual([]);
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([
			expect.objectContaining({ targetSessionId: 's-a1' }),
		]);
	});

	it('ignores a sibling chat backlog when the captured chat is free', async () => {
		await openPromptPipeline([chat('s-a1'), chat('s-a2')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		agentPromptQueue.setPaused(WORKSTREAM, true);
		agentPromptQueue.enqueue({
			workstreamId: WORKSTREAM,
			targetSessionId: 's-a2',
			prompt: 'Sibling backlog',
			model: defaultAgentModel(),
		});
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1' }));

		expect(sends()).toEqual([expect.objectContaining({ sessionId: 's-a1' })]);
		expect(queuedPrompts()).toEqual(['Sibling backlog']);
		expect(queuedPromptsQuery.data).toEqual([]);
	});

	it('interrupts a sibling chat that waits for an answer, then sends the prompt', async () => {
		const { platform } = await openPromptPipeline([
			chat('s-a1'),
			chat('s-a2', { status: 'waiting_for_approval', displayName: 'Refactor' }),
		]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const info = vi.spyOn(toast, 'info');
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1', prompt: 'Take over' }));

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ sessionId: 's-a1', prompt: 'Take over' }),
			]),
		);
		expect(platform.calls).toContainEqual({
			command: 'chat.cancel-run',
			args: { sessionId: 's-a2' },
		});
		expect(info).toHaveBeenCalledWith('Interrupted Refactor · it was waiting for your answer', {
			context: { workstream: WORKSTREAM },
		});
	});

	it('keeps the prompt queued and says why when the waiting sibling chat cannot be stopped', async () => {
		const { platform } = await openPromptPipeline([
			chat('s-a1'),
			chat('s-a2', { status: 'waiting_for_approval', displayName: 'Refactor' }),
		]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		platform.define('chat.cancel-run', async () => {
			throw new Error('bridge unreachable');
		});
		const error = vi.spyOn(toast, 'error');
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1', prompt: 'Take over' }));

		await vi.waitFor(() =>
			expect(error).toHaveBeenCalledWith('bridge unreachable', {
				context: { workstream: WORKSTREAM },
			}),
		);
		expect(sends()).toEqual([]);
		expect(queuedPrompts()).toEqual(['Take over']);
	});

	it('queues into the submitted workstream even when the route shows another one', async () => {
		await openPromptPipeline([
			chat('s-b', { workstreamId: SIBLING_WORKSTREAM, status: 'running' }),
		]);
		rememberChatTurn('s-b');

		await submit(
			submission({ workstreamId: SIBLING_WORKSTREAM, sessionId: 's-b', prompt: 'For B' }),
		);

		expect(queuedPrompts(SIBLING_WORKSTREAM)).toEqual(['For B']);
		expect(queuedPrompts(WORKSTREAM)).toEqual([]);
	});
});

describe('starting a fresh chat', () => {
	it('waits for the running chat, then sends the prompt to a new chat', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		startFreshChatCommand();
		await vi.waitFor(() => expect(chatSessionStore.emptySessionMode).toBe('fresh'));
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: null, forceFreshSession: true, prompt: 'Clean slate' }));

		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([
			expect.objectContaining({ targetSessionId: null, forceFreshSession: true }),
		]);
		expect(chatSessionStore.emptySessionMode).toBe('setup');
		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(false);

		completeRun('s-a1');

		await vi.waitFor(() => expect(sends()).toHaveLength(1));
		const fresh = sends()[0]?.sessionId;
		expect(fresh).not.toBe('s-a1');
		expect(sends()[0]).toMatchObject({ prompt: 'Clean slate' });
		expect(chatSessionStore.sessionId).toBe(fresh);
	});

	it('sends the next prompt to a new chat after the model changes mid-chat', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const sends = recordPromptDelivery();

		selectModelCommand(OTHER_MODEL);

		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(true);
		await submit(
			submission({
				sessionId: 's-a1',
				model: OTHER_MODEL,
				forceFreshSession: chatSessionStore.createFreshSessionOnNextPrompt,
			}),
		);

		expect(platform.calls).toContainEqual({
			command: 'chat.start-session',
			args: expect.objectContaining({ model: OTHER_MODEL }),
		});
		const fresh = sends()[0]?.sessionId;
		expect(fresh).toBeDefined();
		expect(fresh).not.toBe('s-a1');
		expect(chatSessionStore.sessionId).toBe(fresh);
	});

	it('keeps the chat when the selected model does not change', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';

		selectModelCommand(defaultAgentModel());

		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(false);
	});
});

describe('prompt dispatch failures', () => {
	it('reports a chat that cannot start as a session error', async () => {
		await openPromptPipeline([], {
			agentSessionBootstrapFailures: 1,
			agentSessionBootstrapError: 'runtime offline',
		});

		await expect(submit(submission())).rejects.toThrow('runtime offline');

		expect(chatSessionStore.bootError).toBe('runtime offline');
	});

	it('reports a live stream that cannot connect as a session error', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		vi.spyOn(agentEventStream, 'ensureStarted').mockRejectedValueOnce(new Error('listener down'));

		const failure = submitAndSettle(submission({ sessionId: 's-a1' }));

		await expect(failure).resolves.toEqual({ status: 'failed', error: 'listener down' });
		expect(chatSessionStore.bootError).toBe('listener down');
		expect(pendingPromptQuery.data('s-a1')).toBeNull();
		expect(chatRunningQuery.data).toBe(false);
	});

	it('rejects a provider failure without blocking the chat', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const delivery = holdPromptDelivery();

		const failure = submitAndSettle(submission({ sessionId: 's-a1' }));
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		delivery.fail(new Error('provider exploded'));

		await expect(failure).resolves.toEqual({ status: 'failed', error: 'provider exploded' });
		expect(chatSessionStore.bootError).toBeNull();
		expect(pendingPromptQuery.data('s-a1')).toBeNull();
		expect(chatRunningQuery.data).toBe(false);
	});

	it.each([
		['already-running', 'Session s-a1 already has an active run'],
		['cancel-race', 'cancel race: the previous run is still stopping'],
	])('queues the prompt when the provider reports %s', async (_failure, message) => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const delivery = holdPromptDelivery();

		const sent = submit(submission({ sessionId: 's-a1', prompt: 'Retry me' }));
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		delivery.fail(new Error(message));

		await expect(sent).resolves.toBeUndefined();
		expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([
			expect.objectContaining({ prompt: 'Retry me', targetSessionId: 's-a1' }),
		]);
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('sends a prompt the runtime refused while it was still closing the previous run', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const deliver = agentSessions.sendPrompt.bind(agentSessions);
		let attempts = 0;
		vi.spyOn(agentSessions, 'sendPrompt').mockImplementation(async (input) => {
			attempts += 1;
			if (attempts === 1) throw new Error('work stream `w` already has an active run');
			return deliver(input);
		});

		await submit(submission({ sessionId: 's-a1', prompt: 'Retry me' }));

		await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 3_000 });
		await vi.waitFor(() => expect(queuedPrompts()).toEqual([]));
	});

	it('keeps a queued prompt and shows why when the drain cannot deliver it', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', prompt: 'Queued' }));
		const [entry] = agentPromptQueue.entriesFor(WORKSTREAM);
		platform.define('chat.send-prompt', async () => {
			throw new Error('provider exploded');
		});
		const error = vi.spyOn(toast, 'error');

		completeRun('s-a1');

		await vi.waitFor(() =>
			expect(queueErrorsQuery.data).toEqual({ [entry?.id ?? '']: 'provider exploded' }),
		);
		expect(queuedPrompts()).toEqual(['Queued']);
		expect(chatSessionStore.bootError).toBeNull();
		expect(error).toHaveBeenCalledWith('Queued prompt is still waiting · provider exploded', {
			context: { workstream: WORKSTREAM },
		});
	});

	it('reports a queued prompt whose new chat cannot start as a session error', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		startRun('s-a1');
		await submit(submission({ sessionId: 's-a1', forceFreshSession: true, prompt: 'Fresh' }));
		platform.define('chat.start-session', async () => {
			throw new Error('runtime offline');
		});

		completeRun('s-a1');

		await vi.waitFor(() => expect(chatSessionStore.bootError).toBe('runtime offline'));
		expect(queueErrorsQuery.data).toEqual({});
		expect(queuedPrompts()).toEqual(['Fresh']);
	});
});
