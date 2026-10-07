import { afterEach, describe, expect, it } from 'vitest';
import {
	SIBLING_WORKSTREAM,
	chat,
	openPromptPipeline,
	rememberChatTurn,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { navigateChatRoute } from '$lib/chat/application/chat-route.testkit.svelte';
import { selectModelCommand } from '$lib/chat/application/commands/select-model.command';
import { selectRunProfileCommand } from '$lib/chat/application/commands/select-run-profile.command';
import { activeModelQuery } from '$lib/chat/application/queries/active-model.query.svelte';
import { runProfileQuery } from '$lib/chat/application/queries/run-profile.query.svelte';
import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

afterEach(async () => {
	await resetPromptPipeline();
});

describe('picking a model', () => {
	it('starts every other workstream with the model last picked for each mode', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		selectModelCommand('opus');
		selectRunProfileCommand({ mode: 'plan', effort: 'medium', access: 'sandboxed' });
		selectModelCommand('sonnet');

		await navigateChatRoute(`/workstreams/${SIBLING_WORKSTREAM}`);
		await chatBootstrap.run(SIBLING_WORKSTREAM, chatSessionStore.bootstrapSeq);

		expect(runProfileQuery.data.mode).toBe('agent');
		expect(activeModelQuery.data).toBe('opus');
		selectRunProfileCommand({ mode: 'plan', effort: 'medium', access: 'sandboxed' });
		expect(activeModelQuery.data).toBe('sonnet');
	});
});
