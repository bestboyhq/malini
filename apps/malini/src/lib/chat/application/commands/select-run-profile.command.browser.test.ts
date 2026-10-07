import { afterEach, describe, expect, it } from 'vitest';
import {
	chat,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
	submission,
	submit,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { selectRunProfileCommand } from '$lib/chat/application/commands/select-run-profile.command';
import { activeModelQuery } from '$lib/chat/application/queries/active-model.query.svelte';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

afterEach(async () => {
	await resetPromptPipeline();
});

describe('switching between plan and agent mode', () => {
	it('plans in a fresh chat with the planning model, then returns to the implementation chat', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		const sends = recordPromptDelivery();

		selectRunProfileCommand({ mode: 'plan', effort: 'high', access: 'sandboxed' });

		expect(activeModelQuery.data).toBe(chatModelStore.rememberedModels.planning.model);
		expect(chatModelStore.profile).toEqual({ mode: 'plan', effort: 'high', access: 'sandboxed' });
		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(true);

		selectRunProfileCommand({ mode: 'agent', effort: 'medium', access: 'sandboxed' });

		expect(activeModelQuery.data).toBe(chatModelStore.rememberedModels.implementation.model);
		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(false);

		selectRunProfileCommand({ mode: 'plan', effort: 'high', access: 'sandboxed' });
		await submit(
			submission({
				sessionId: 's-a1',
				model: activeModelQuery.data,
				profile: { ...chatModelStore.profile },
				forceFreshSession: chatSessionStore.createFreshSessionOnNextPrompt,
			}),
		);

		const [sent] = sends();
		expect(sent?.sessionId).not.toBe('s-a1');
		expect(sent).toMatchObject({ profile: { mode: 'plan' } });
	});
});
