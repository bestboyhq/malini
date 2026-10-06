import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chatSession,
	deferred,
	envelope,
	holdNavigation,
	installChatPlatform,
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { chatPreparingQuery } from '$lib/chat/application/queries/chat-preparing.query.svelte';
import { forkToNewChatCommand } from '$lib/chat/application/commands/fork-to-new-chat.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { presentedTranscriptQuery } from '$lib/chat/application/queries/presented-transcript.query.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { router } from '$shared/router/hash-router.svelte';
import {
	mountChatRoute,
	type ChatRouteHarness,
	type PresentedFrame,
} from './follow-chat-route.harness.svelte';

const OWNERS: Readonly<Record<string, string>> = {
	's-a': 'ws-a',
	's-a2': 'ws-a',
	's-b': 'ws-b',
};

let harness: ChatRouteHarness | null = null;

function mount(): ChatRouteHarness {
	harness = mountChatRoute();
	flushSync();
	return harness;
}

async function navigate(path: string): Promise<void> {
	await router.goto(path);
	await settleChatRoute();
}

async function chatOpened(workstreamId: string, sessionId: string | null): Promise<void> {
	await vi.waitFor(() => {
		expect(router.page.params.workstreamId).toBe(workstreamId);
		expect(chatPreparingQuery.data).toBe(false);
		expect(chatSessionStore.sessionId).toBe(sessionId);
	});
	await settleChatRoute();
}

function framesPresentingAnotherWorkstreamsChat(
	frames: readonly PresentedFrame[],
): readonly PresentedFrame[] {
	return frames.filter(
		(frame) =>
			frame.presentedWorkstreamId !== frame.routeWorkstreamId ||
			(frame.presentedSessionId !== null &&
				OWNERS[frame.presentedSessionId] !== frame.routeWorkstreamId) ||
			(frame.activeSessionId !== null &&
				OWNERS[frame.activeSessionId] !== frame.routeWorkstreamId) ||
			frame.envelopeSessionIds.some((sessionId) => sessionId !== frame.presentedSessionId),
	);
}

afterEach(async () => {
	harness?.release();
	harness = null;
	vi.restoreAllMocks();
	await resetChatState();
});

describe('following the chat route across workstreams', () => {
	it('never presents the previous workstream chat as the next one, there and back', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-b', 'ws-b')]);
		await startChatRouter('/workstreams/ws-a');
		const { frames } = mount();
		await chatOpened('ws-a', 's-a');

		await navigate('/workstreams/ws-b');
		await chatOpened('ws-b', 's-b');
		expect(presentedTranscriptQuery.data).toMatchObject({ workstreamId: 'ws-b', sessionId: 's-b' });

		await navigate('/workstreams/ws-a');
		await chatOpened('ws-a', 's-a');
		expect(presentedTranscriptQuery.data).toMatchObject({ workstreamId: 'ws-a', sessionId: 's-a' });

		expect(frames.some((frame) => frame.routeWorkstreamId === 'ws-b')).toBe(true);
		expect(framesPresentingAnotherWorkstreamsChat(frames)).toEqual([]);
	});

	it('presents nothing for a workstream without chats after leaving one with a chat', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-b', 'ws-b')]);
		await startChatRouter('/workstreams/ws-a');
		const { frames } = mount();
		await chatOpened('ws-a', 's-a');
		await navigate('/workstreams/ws-b');
		await chatOpened('ws-b', 's-b');

		await navigate('/workstreams/ws-c');
		await chatOpened('ws-c', null);

		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: 'ws-c',
			sessionId: null,
			envelopes: [],
		});
		expect(framesPresentingAnotherWorkstreamsChat(frames)).toEqual([]);
	});

	it('clears every chat singleton when released', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a')]);
		await startChatRouter('/workstreams/ws-a');
		mount();
		await chatOpened('ws-a', 's-a');

		harness?.release();
		harness = null;

		expect(transcriptAggregate.envelopesBySession).toEqual({});
		expect(transcriptAggregate.readyBySession).toEqual({});
		expect(transcriptAggregate.ownerBySession).toEqual({});
		expect(transcriptAggregate.retainedPresentation).toBeNull();
		expect(chatSessionStore.sessionId).toBeNull();
		expect(chatSessionStore.projectedFor).toBeNull();
		expect(chatSessionStore.bootstrappedFor).toBeNull();
		expect(chatSessionStore.bootingWorkstreamId).toBeNull();
	});

	it('mounts on the routed workstream without state left by an earlier chat surface', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-b', 'ws-b')]);
		await startChatRouter('/workstreams/ws-a');
		chatSessionStore.sessionId = 's-b';
		chatSessionStore.projectedFor = 'ws-a';
		chatSessionStore.bootstrappedFor = 'ws-a';
		transcriptAggregate.adoptProjection('s-b', [envelope('s-b', 1)]);
		transcriptAggregate.markReady('s-b');
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-a', sessionId: 's-b' };

		const { frames } = mount();

		expect(frames[0]).toMatchObject({ presentedSessionId: null, activeSessionId: null });
		await chatOpened('ws-a', 's-a');
		expect(frames.some((frame) => frame.activeSessionId === 's-b')).toBe(false);
		expect(framesPresentingAnotherWorkstreamsChat(frames)).toEqual([]);
	});
});

describe('the first paint of a routed chat', () => {
	it('restores and selects only the routed chat before first paint', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-a2', 'ws-a')]);
		for (const [sessionId, workstreamId, startedAt] of [
			['s-a', 'ws-a', '2026-01-03T00:00:00.000Z'],
			['s-a2', 'ws-a', '2026-01-01T00:00:00.000Z'],
			['s-b', 'ws-b', '2026-01-02T00:00:00.000Z'],
		] as const) {
			sessionsAggregate.ensureSession({ sessionId, workstreamId, model: null, startedAt });
			sessionsAggregate.applyEventBatch([envelope(sessionId, 1)]);
		}
		await startChatRouter('/workstreams/ws-a?agent=s-a2');

		harness = mountChatRoute();

		expect(harness.frames[0]).toEqual({
			routeWorkstreamId: 'ws-a',
			presentedWorkstreamId: 'ws-a',
			presentedSessionId: 's-a2',
			envelopeSessionIds: ['s-a2'],
			activeSessionId: 's-a2',
		});
		expect(Object.keys(transcriptAggregate.envelopesBySession)).toEqual(['s-a2']);
	});

	it('restores a warm workstream before its bootstrap reads the session list', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-b', 'ws-b')]);
		await startChatRouter('/workstreams/ws-b');
		const { frames } = mount();
		await chatOpened('ws-b', 's-b');
		await navigate('/workstreams/ws-a');
		await chatOpened('ws-a', 's-a');

		const listing = deferred();
		const list = agentSessions.list.bind(agentSessions);
		let restoredBeforeListing: boolean | null = null;
		vi.spyOn(agentSessions, 'list').mockImplementation(async (workstreamId) => {
			if (workstreamId !== 'ws-b') return list(workstreamId);
			restoredBeforeListing =
				chatSessionStore.projectedFor === 'ws-b' &&
				transcriptAggregate.isReady('s-b') &&
				chatSessionStore.sessionId === 's-b';
			await listing.promise;
			return list(workstreamId);
		});
		const framesBeforeReturn = frames.length;

		await navigate('/workstreams/ws-b');

		expect(chatPreparingQuery.data).toBe(true);
		expect(restoredBeforeListing).toBe(true);
		expect(
			frames.slice(framesBeforeReturn).find((frame) => frame.routeWorkstreamId === 'ws-b'),
		).toEqual({
			routeWorkstreamId: 'ws-b',
			presentedWorkstreamId: 'ws-b',
			presentedSessionId: 's-b',
			envelopeSessionIds: ['s-b', 's-b'],
			activeSessionId: 's-b',
		});

		listing.resolve();
		await chatOpened('ws-b', 's-b');
	});
});

describe('reconciling the chat route', () => {
	it('lets bootstrap repair a stale remembered chat before the route can activate it', async () => {
		const platform = installChatPlatform([chatSession('s-a', 'ws-a')]);
		await startChatRouter('/workstreams/ws-a?agent=s-stale');

		mount();
		await chatOpened('ws-a', 's-a');

		expect(chatSessionStore.bootError).toBeNull();
		expect(router.page.url.searchParams.get('agent')).toBe('s-a');
		expect(
			platform.calls
				.filter(({ command }) => command === 'chat.activate-session')
				.map(({ args }) => args),
		).toEqual([{ sessionId: 's-a' }]);
	});

	it('retires the presented chat when it disappears and the route stops naming it', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a')]);
		await startChatRouter('/workstreams/ws-a');
		mount();
		await chatOpened('ws-a', 's-a');

		sessionsAggregate.removeSession('s-a');
		await navigate('/workstreams/ws-a');
		flushSync();

		expect(chatSessionStore.sessionId).toBeNull();
		expect(chatSessionStore.emptySessionMode).toBe('fresh');
		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: 'ws-a',
			sessionId: null,
			envelopes: [],
		});
	});

	it('does not commit a chat whose activation resolves after navigation starts elsewhere', async () => {
		installChatPlatform([
			chatSession('s-a', 'ws-a', '2026-01-02T00:00:00.000Z'),
			chatSession('s-a2', 'ws-a', '2026-01-01T00:00:00.000Z'),
			chatSession('s-b', 'ws-b'),
		]);
		await startChatRouter('/workstreams/ws-a');
		const { frames } = mount();
		await chatOpened('ws-a', 's-a');

		const activation = deferred();
		const activate = agentSessions.activate.bind(agentSessions);
		let activationStarted = false;
		vi.spyOn(agentSessions, 'activate').mockImplementation(async (sessionId) => {
			if (sessionId !== 's-a2') return activate(sessionId);
			activationStarted = true;
			await activation.promise;
			return activate(sessionId);
		});
		await navigate('/workstreams/ws-a?agent=s-a2');
		await vi.waitFor(() => expect(activationStarted).toBe(true));

		const leaving = holdNavigation((url) => url.pathname === '/workstreams/ws-b');
		void router.goto('/workstreams/ws-b');
		await vi.waitFor(() => expect(leaving.started()).toBe(true));
		activation.resolve();
		await vi.waitFor(() => expect(chatSessionStore.activatingSessionId).toBeNull());
		flushSync();

		expect(router.page.params.workstreamId).toBe('ws-a');
		expect(chatSessionStore.sessionId).toBe('s-a');

		leaving.release();
		await chatOpened('ws-b', 's-b');
		expect(frames.some((frame) => frame.activeSessionId === 's-a2')).toBe(false);
		expect(framesPresentingAnotherWorkstreamsChat(frames)).toEqual([]);
	});
});

describe('forking a chat into a new one', () => {
	it('opens the chat of its own without the route reopening the chat it forked from', async () => {
		installChatPlatform([chatSession('s-a', 'ws-a')]);
		await startChatRouter('/workstreams/ws-a?agent=s-a');
		mount();
		await chatOpened('ws-a', 's-a');

		const requestId = newChatRequestId();
		forkToNewChatCommand({ requestId, atSeq: 1 });

		await expect(chatRequestsStore.settled(requestId)).resolves.toEqual({ status: 'accepted' });
		const forked = chatSessionStore.sessionId;
		expect(forked).not.toBeNull();
		expect(forked).not.toBe('s-a');
		await chatOpened('ws-a', forked);
		expect(router.page.url.searchParams.get('agent')).toBe(forked);
	});
});

describe('returning to the open chat while another one is opening', () => {
	it('cancels the chat the route asked for before', async () => {
		installChatPlatform([
			chatSession('s-a', 'ws-a', '2026-01-02T00:00:00.000Z'),
			chatSession('s-a2', 'ws-a', '2026-01-01T00:00:00.000Z'),
		]);
		await startChatRouter('/workstreams/ws-a?agent=s-a');
		const { frames } = mount();
		await chatOpened('ws-a', 's-a');
		const opening = deferred();
		let held = false;
		const listEvents = agentSessions.listEvents.bind(agentSessions);
		vi.spyOn(agentSessions, 'listEvents').mockImplementation(async (sessionId, afterSeq) => {
			if (sessionId === 's-a2') {
				held = true;
				await opening.promise;
			}
			return listEvents(sessionId, afterSeq);
		});

		await navigate('/workstreams/ws-a?agent=s-a2');
		await vi.waitFor(() => expect(held).toBe(true));
		expect(chatSessionStore.activatingSessionId).toBe('s-a2');
		const returnedAt = frames.length;
		await navigate('/workstreams/ws-a?agent=s-a');
		opening.resolve();
		await settleChatRoute();

		await chatOpened('ws-a', 's-a');
		expect(chatSessionStore.activatingSessionId).toBeNull();
		expect(router.page.url.searchParams.get('agent')).toBe('s-a');
		expect(frames.slice(returnedAt).map((frame) => frame.activeSessionId)).not.toContain('s-a2');
	});
});
