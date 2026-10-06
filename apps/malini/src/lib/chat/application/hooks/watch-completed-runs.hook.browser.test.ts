import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { resetChatState } from '$lib/chat/application/chat-route.testkit.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { watchCompletedRunsHook } from './watch-completed-runs.hook';

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

function emit(platform: FakePlatform, type: string, runId: string, sessionId = 'sid-x'): void {
	platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId,
		runId,
		seq: 1,
		event: type === 'run.completed' ? { type, runId, summary: 'done' } : { type, runId },
	});
}

describe('watching completed agent runs', () => {
	it('names the workstream and run of each completed run, and nothing else', async () => {
		const platform = platformWithChat();
		const completed: string[][] = [];
		const release = watchCompletedRunsHook((workstreamId, runId) =>
			completed.push([workstreamId, runId]),
		);
		await vi.waitFor(() => {
			emit(platform, 'run.completed', 'r1');
			expect(completed).toEqual([['ws-x', 'r1']]);
		});

		emit(platform, 'run.failed', 'r2');
		emit(platform, 'file.changed', 'r3');
		emit(platform, 'run.completed', 'r4', 'sid-unknown');
		emit(platform, 'run.completed', 'r5');
		release();
		emit(platform, 'run.completed', 'r6');

		expect(completed).toEqual([
			['ws-x', 'r1'],
			['ws-x', 'r5'],
		]);
	});
});
