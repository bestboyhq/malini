import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	WORKSTREAM,
	chat,
	holdPromptDelivery,
	openPromptPipeline,
	recordPromptDelivery,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { implementPlanCommand } from '$lib/chat/application/commands/implement-plan.command';
import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
import { newChatRequestId, type ChatRequestOutcome } from '$lib/chat/domain/chat-request';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

afterEach(async () => {
	await resetPromptPipeline();
});

function implementPlan(
	sourceSessionId: string,
	requestId = newChatRequestId(),
): Promise<ChatRequestOutcome> {
	implementPlanCommand({
		requestId,
		workstreamId: WORKSTREAM,
		plan: '1. Add the endpoint',
		sourceSessionId,
		sourceRunId: 'run-plan',
	});
	return chatRequestsStore.settled(requestId);
}

describe('implementing a prepared plan', () => {
	it('sends the plan and its original request to a fresh implementation chat', async () => {
		await openPromptPipeline([chat('s-plan'), chat('s-b', { workstreamId: 'ws-b' })], {
			agentEvents: {
				's-plan': [
					{
						runId: 'run-plan',
						event: {
							type: 'user.message',
							runId: 'run-plan',
							text: 'Add a health endpoint',
							contextFiles: ['src/server.ts'],
						},
					},
				],
			},
		});
		await sessionActivation.hydrate('s-plan');
		chatSessionStore.sessionId = 's-plan';
		chatModelStore.profile = { mode: 'plan', effort: 'high', access: 'sandboxed' };
		const sends = recordPromptDelivery();

		await expect(implementPlan('s-plan')).resolves.toEqual({ status: 'accepted' });

		expect(sends()).toHaveLength(1);
		const [sent] = sends();
		expect(sent?.sessionId).not.toBe('s-plan');
		expect(sent).toMatchObject({ contextFiles: ['src/server.ts'], profile: { mode: 'agent' } });
		expect(sent?.prompt).toContain('Add a health endpoint');
		expect(sent?.prompt).toContain('1. Add the endpoint');
		expect(chatSessionStore.sessionId).toBe(sent?.sessionId);
		expect(chatModelStore.profile.mode).toBe('agent');
	});

	it('refuses a plan from another workstream', async () => {
		await openPromptPipeline([chat('s-b', { workstreamId: 'ws-b' })]);
		const sends = recordPromptDelivery();
		const error = vi.spyOn(toast, 'error');

		await expect(implementPlan('s-b')).resolves.toEqual({
			status: 'failed',
			error: 'The source plan no longer belongs to this workstream',
		});
		await vi.waitFor(() => expect(sends()).toEqual([]));
		expect(error).toHaveBeenCalledWith(
			'Could not start the implementation chat · The source plan no longer belongs to this workstream',
			{ context: { workstream: WORKSTREAM } },
		);
	});

	it('reports the plan as busy from dispatch until the implementation chat accepts it', async () => {
		await openPromptPipeline([chat('s-plan')], {
			agentEvents: {
				's-plan': [
					{ runId: 'run-plan', event: { type: 'user.message', runId: 'run-plan', text: 'Plan' } },
				],
			},
		});
		await sessionActivation.hydrate('s-plan');
		chatSessionStore.sessionId = 's-plan';
		const delivery = holdPromptDelivery();
		const requestId = newChatRequestId();

		const settledOutcome = implementPlan('s-plan', requestId);

		expect(chatRequestQuery.data(requestId)).toEqual({ status: 'pending' });
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		expect(chatRequestQuery.data(requestId)).toEqual({ status: 'pending' });
		delivery.release();
		await expect(settledOutcome).resolves.toEqual({ status: 'accepted' });
		expect(chatRequestQuery.data(requestId)).toEqual({ status: 'accepted' });
	});
});
