import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chatSession,
	mountChatHook,
	navigateChatRoute,
	openChatRoute,
	resetChatState,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { followChatRouteHook } from '$lib/chat/application/hooks/follow-chat-route.hook.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';

const WORKSTREAM = 'ws-a';

async function openChat(sessionId: string): Promise<FakePlatform> {
	const platform = createFakePlatform({
		agentSessions: [
			chatSession('s-idle', WORKSTREAM),
			{ id: 's-running', workstreamId: WORKSTREAM, currentRunId: 'run-open' },
		],
	});
	await openChatRoute(`/workstreams/${WORKSTREAM}?agent=${sessionId}`, platform);
	mountChatHook(connectAgentEventsHook);
	mountChatHook(followChatRouteHook);
	await vi.waitFor(() => expect(chatSessionStore.sessionId).toBe(sessionId));
	await settleChatRoute();
	return platform;
}

async function startNewChat(): Promise<string> {
	const previous = chatSessionStore.sessionId;
	await startFreshChatCommand();
	await settleChatRoute();
	const sessionId = chatSessionStore.sessionId;
	if (!sessionId || sessionId === previous) throw new Error('no new chat was opened');
	expect(chatRoute.readSessionParam()).toBe(sessionId);
	return sessionId;
}

async function openChatIds(): Promise<readonly string[]> {
	return (await agentSessions.list(WORKSTREAM)).map(({ id }) => id).sort();
}

afterEach(async () => {
	vi.restoreAllMocks();
	await resetChatState();
});

describe('starting a new chat', () => {
	it('keeps every new chat after the user leaves it without sending a message', async () => {
		const platform = await openChat('s-idle');

		const first = await startNewChat();
		const second = await startNewChat();
		await navigateChatRoute(`/workstreams/${WORKSTREAM}?agent=s-idle`);
		await vi.waitFor(() => expect(chatSessionStore.sessionId).toBe('s-idle'));
		await settleChatRoute();

		expect(await openChatIds()).toEqual([first, second, 's-idle', 's-running'].sort());
		expect(platform.calls.filter(({ command }) => command === 'chat.archive-session')).toEqual([]);
	});

	it('opens a new chat while the current chat is still running', async () => {
		await openChat('s-running');

		const opened = await startNewChat();

		expect(await openChatIds()).toEqual([opened, 's-idle', 's-running'].sort());
	});
});
