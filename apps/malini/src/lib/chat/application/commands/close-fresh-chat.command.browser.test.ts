import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chat,
	openPromptPipeline,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { closeFreshChatCommand } from '$lib/chat/application/commands/close-fresh-chat.command';
import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
import { freshChatReturnQuery } from '$lib/chat/application/queries/fresh-chat-return.query.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { router } from '$shared/router/hash-router.svelte';

afterEach(async () => {
	await resetPromptPipeline();
});

const chats = [
	chat('s-a1', { startedAt: '2026-01-01T00:00:00.000Z' }),
	chat('s-a2', { startedAt: '2026-01-02T00:00:00.000Z' }),
	chat('s-b', { workstreamId: 'ws-b' }),
];

describe('closing a fresh chat', () => {
	it('returns to the chat the fresh chat was opened from', async () => {
		await openPromptPipeline(chats);
		chatSessionStore.sessionId = 's-a1';
		startFreshChatCommand();
		await vi.waitFor(() => expect(chatSessionStore.emptySessionMode).toBe('fresh'));

		expect(freshChatReturnQuery.data).toBe('/workstreams/ws-a?agent=s-a1');

		closeFreshChatCommand();

		await vi.waitFor(() => expect(chatSessionStore.sessionId).toBe('s-a1'));
		expect(chatSessionStore.emptySessionMode).toBe('setup');
		expect(chatSessionStore.freshReturnSessionId).toBeNull();
		expect(router.page.url.searchParams.get('agent')).toBe('s-a1');
	});

	it('falls back to the latest chat of the workstream', async () => {
		await openPromptPipeline(chats);
		chatSessionStore.emptySessionMode = 'fresh';
		chatSessionStore.freshReturnSessionId = 's-b';

		expect(freshChatReturnQuery.data).toBe('/workstreams/ws-a?agent=s-a2');

		closeFreshChatCommand();

		await vi.waitFor(() => expect(chatSessionStore.sessionId).toBe('s-a2'));
	});

	it('stays put while the open chat is running', async () => {
		await openPromptPipeline([chat('s-a1', { status: 'running' }), chat('s-a2')]);
		chatSessionStore.sessionId = 's-a1';
		chatSessionStore.emptySessionMode = 'fresh';
		chatSessionStore.freshReturnSessionId = 's-a2';

		closeFreshChatCommand();

		expect(chatSessionStore.freshReturnSessionId).toBe('s-a2');
		expect(chatSessionStore.emptySessionMode).toBe('fresh');
	});
});
