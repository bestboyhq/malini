import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { resetChatState } from '$lib/chat/application/chat-route.testkit.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { watchAgentChangeTriggersHook } from './watch-agent-change-triggers.hook';

afterEach(async () => {
	await resetChatState();
});

function platformWithChat(): FakePlatform {
	const platform = createFakePlatform();
	setPlatformForTest(platform);
	sessionsAggregate.hydrateSession({
		sessionId: 'sid-x',
		workstreamId: 'ws-x',
		model: null,
		status: 'running',
		startedAt: '2026-01-01T00:00:00.000Z',
	});
	return platform;
}

function emit(platform: FakePlatform, type: string, sessionId = 'sid-x'): void {
	platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId,
		runId: 'r1',
		seq: 1,
		event: { type, runId: 'r1' },
	});
}

describe('watching agent events that change a workstream', () => {
	it('names the workstream of the chat whose run completed, changed a file, or ran a command', async () => {
		const platform = platformWithChat();
		const fired: string[] = [];
		const release = watchAgentChangeTriggersHook((workstreamId) => fired.push(workstreamId));
		await vi.waitFor(() => {
			emit(platform, 'run.completed');
			expect(fired).toEqual(['ws-x']);
		});

		emit(platform, 'file.changed');
		emit(platform, 'command.completed');
		emit(platform, 'assistant.message');
		emit(platform, 'run.completed', 'sid-unknown');

		expect(fired).toEqual(['ws-x', 'ws-x', 'ws-x']);
		release();
	});

	it('stops reporting once released, even when released before the subscription landed', async () => {
		const platform = platformWithChat();
		const fired: string[] = [];

		watchAgentChangeTriggersHook((workstreamId) => fired.push(workstreamId))();
		const release = watchAgentChangeTriggersHook((workstreamId) =>
			fired.push(`late:${workstreamId}`),
		);
		await vi.waitFor(() => {
			emit(platform, 'run.completed');
			expect(fired).toEqual(['late:ws-x']);
		});
		release();
		emit(platform, 'run.completed');

		expect(fired).toEqual(['late:ws-x']);
	});
});
