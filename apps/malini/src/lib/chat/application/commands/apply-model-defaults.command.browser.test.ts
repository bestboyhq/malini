import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chat,
	openPromptPipeline,
	rememberChatTurn,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { applyModelDefaultsCommand } from '$lib/chat/application/commands/apply-model-defaults.command';
import { activeModelQuery } from '$lib/chat/application/queries/active-model.query.svelte';
import { implementationModelLabelQuery } from '$lib/chat/application/queries/implementation-model-label.query.svelte';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { modelDefaultsQuery } from '$shared/providers/providers.api';

afterEach(async () => {
	await resetPromptPipeline();
});

const defaults = {
	planning: { model: 'claude-opus-5' },
	implementation: { model: 'opus[1m]' },
} as const;

describe('saving model defaults from the chat', () => {
	it('saves the defaults, adopts them in this workstream and starts the next prompt fresh', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		chatSessionStore.sessionId = 's-a1';
		chatModelStore.rememberRoleSelection('ws-a', 'implementation', {
			model: 'haiku',
		});
		const info = vi.spyOn(toast, 'info');

		applyModelDefaultsCommand(defaults);

		expect(modelDefaultsQuery.data).toEqual(defaults);
		expect(chatModelStore.workstreamPreferences).toEqual(defaults);
		expect(chatModelStore.loadPreferencesFor('ws-a').memory).toEqual(defaults);
		expect(activeModelQuery.data).toBe('opus[1m]');
		expect(implementationModelLabelQuery.data).toBe('Opus 1M');
		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(true);
		expect(info).toHaveBeenCalledWith('Model defaults saved · this workstream updated');
	});
});
