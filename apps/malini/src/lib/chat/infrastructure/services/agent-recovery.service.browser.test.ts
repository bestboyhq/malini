import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	resetChatState,
	mountChatHook,
	navigateChatRoute,
	openChatRoute,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { followChatRouteHook } from '$lib/chat/application/hooks/follow-chat-route.hook.svelte';
import { chatRunningQuery } from '$lib/chat/application/queries/chat-running.query.svelte';
import { agentRecovery } from '$lib/chat/infrastructure/services/agent-recovery.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';

const SOURCE = 'ws-source';
const DESTINATION = 'ws-destination';
const RUNNING = 'session-running';

function seededPlatform(): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: RUNNING, workstreamId: SOURCE, currentRunId: 'run-open' },
			{ id: 'session-destination', workstreamId: DESTINATION },
		],
	});
}

function callsTo(platform: FakePlatform, command: string): readonly unknown[] {
	return platform.calls.filter((call) => call.command === command).map((call) => call.args);
}

async function bootRunningChat(): Promise<FakePlatform> {
	const platform = seededPlatform();
	await openChatRoute(`/workstreams/${SOURCE}`, platform);
	mountChatHook(connectAgentEventsHook);
	mountChatHook(followChatRouteHook);
	await vi.waitFor(() => {
		expect(chatSessionStore.sessionId).toBe(RUNNING);
		expect(chatRoute.readSessionParam()).toBe(RUNNING);
	});
	await settleChatRoute();
	expect(chatRunningQuery.data).toBe(true);
	return platform;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await resetChatState();
});

describe('agent process restart', () => {
	it('leaves the source workstream’s run alone once the route has moved to another workstream', async () => {
		const platform = await bootRunningChat();
		const clearBridgeDead = vi.spyOn(agentRunner, 'clearBridgeDead');
		const list = agentSessions.list.bind(agentSessions);
		vi.spyOn(agentSessions, 'list').mockImplementation(async (workstreamId) => {
			if (workstreamId === DESTINATION) await new Promise<never>(() => {});
			return list(workstreamId);
		});
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		expect(chatSessionStore.sessionId).toBeNull();

		await agentRecovery.restartAgentProcess();

		expect(callsTo(platform, 'chat.reset-workstream-runs')).toEqual([]);
		expect(callsTo(platform, 'chat.restart-agent')).toEqual([]);
		expect(clearBridgeDead).not.toHaveBeenCalled();
	});

	it('boots the dead session again when its workstream is still on screen', async () => {
		const platform = await bootRunningChat();
		const activations = callsTo(platform, 'chat.activate-session').length;

		await agentRecovery.restartAgentProcess();

		expect(callsTo(platform, 'chat.reset-workstream-runs')).toEqual([{ workstreamId: SOURCE }]);
		expect(callsTo(platform, 'chat.activate-session')).toHaveLength(activations + 1);
		expect(chatSessionStore.sessionId).toBe(RUNNING);
		expect(chatSessionStore.bootError).toBeNull();
	});
});
