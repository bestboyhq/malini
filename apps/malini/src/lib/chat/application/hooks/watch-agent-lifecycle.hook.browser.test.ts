import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '$lib/chat/domain/session-record';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	resetChatState,
	mountChatHook,
	openChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { watchAgentLifecycleHook } from './watch-agent-lifecycle.hook.svelte';

const SOURCE = 'ws-source';
const DESTINATION = 'ws-destination';
const SESSION = 'session-source';

function reportStatus(status: SessionState): void {
	sessionsAggregate.hydrateSession({
		sessionId: SESSION,
		workstreamId: SOURCE,
		model: null,
		status,
		startedAt: '2026-01-01T00:00:00.000Z',
	});
	flushSync();
}

async function selectSourceSessionFrom(path: string): Promise<void> {
	await openChatRoute(path);
	reportStatus('idle');
	transcriptAggregate.rememberOwner(SESSION, SOURCE);
	chatSessionStore.sessionId = SESSION;
}

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await resetChatState();
});

describe('agent lifecycle watch', () => {
	it('reconciles the durable event tail while a native run remains open', async () => {
		await selectSourceSessionFrom(`/workstreams/${SOURCE}`);
		vi.useFakeTimers();
		const hydrate = vi.spyOn(agentEventStream, 'hydrate').mockResolvedValue();
		mountChatHook(watchAgentLifecycleHook);

		vi.advanceTimersByTime(3_000);
		expect(hydrate).not.toHaveBeenCalled();

		reportStatus('running');
		vi.advanceTimersByTime(1_499);
		expect(hydrate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(hydrate).toHaveBeenCalledTimes(1);
		expect(hydrate).toHaveBeenLastCalledWith(SESSION);
		vi.advanceTimersByTime(1_500);
		expect(hydrate).toHaveBeenCalledTimes(2);

		reportStatus('completed');
		vi.advanceTimersByTime(6_000);
		expect(hydrate).toHaveBeenCalledTimes(2);
	});

	it('stops reconciling once the layout lets go of the chat', async () => {
		await selectSourceSessionFrom(`/workstreams/${SOURCE}`);
		reportStatus('running');
		vi.useFakeTimers();
		const hydrate = vi.spyOn(agentEventStream, 'hydrate').mockResolvedValue();
		const release = mountChatHook(watchAgentLifecycleHook);

		release();
		vi.advanceTimersByTime(6_000);
		expect(hydrate).not.toHaveBeenCalled();
	});

	it('keeps the bridge watchdog on the session that owns the run during a cold switch', async () => {
		await selectSourceSessionFrom(`/workstreams/${DESTINATION}`);
		reportStatus('running');
		const setRunOpen = vi.spyOn(agentRunner, 'setRunOpen');
		const release = mountChatHook(watchAgentLifecycleHook);

		expect(setRunOpen).toHaveBeenLastCalledWith(true, {
			workstreamId: SOURCE,
			sessionId: SESSION,
		});

		reportStatus('completed');
		expect(setRunOpen.mock.lastCall?.[0]).toBe(false);

		setRunOpen.mockClear();
		release();
		expect(setRunOpen).toHaveBeenLastCalledWith(false);
	});
});
