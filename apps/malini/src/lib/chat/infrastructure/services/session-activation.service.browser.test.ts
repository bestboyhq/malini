import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chatSession,
	deferred,
	holdNavigation,
	installChatPlatform,
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { agentSessionPreactivation } from '$lib/chat/domain/agent-session-preactivation';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';
import { router } from '$shared/router/hash-router.svelte';
import { agentSessions } from './agent-sessions.service';
import { sessionActivation } from './session-activation.service';

type Platform = ReturnType<typeof installChatPlatform>;

let platform: Platform;
let releaseAgentEvents: (() => void) | null = null;
function gateActivation(sessionId: string): {
	calls: () => number;
	resolve: () => void;
	reject: (reason: unknown) => void;
} {
	const gate = deferred();
	const activate = agentSessions.activate.bind(agentSessions);
	const calls = vi.spyOn(agentSessions, 'activate').mockImplementation(async (id) => {
		if (id !== sessionId) return activate(id);
		await gate.promise;
		return activate(id);
	});
	return {
		calls: () => calls.mock.calls.filter(([id]) => id === sessionId).length,
		resolve: () => gate.resolve(),
		reject: (reason) => gate.reject(reason),
	};
}

function gateReplay(sessionId: string): { started: () => boolean; resolve: () => void } {
	const gate = deferred();
	const listEvents = agentSessions.listEvents.bind(agentSessions);
	let started = false;
	vi.spyOn(agentSessions, 'listEvents').mockImplementation(async (id, afterSeq) => {
		if (id !== sessionId) return listEvents(id, afterSeq);
		started = true;
		await gate.promise;
		return listEvents(id, afterSeq);
	});
	return { started: () => started, resolve: () => gate.resolve() };
}

function measuredPhases(): Array<{ label: string; target: string | undefined }> {
	const phases: Array<{ label: string; target: string | undefined }> = [];
	const measure = runtimeDiagnostics.measure.bind(runtimeDiagnostics);
	vi.spyOn(runtimeDiagnostics, 'measure').mockImplementation((input, operation) => {
		expect(input).toMatchObject({ category: 'runtime', budgetMs: 300 });
		phases.push({ label: input.label, target: input.target });
		return measure(input, operation);
	});
	return phases;
}

beforeEach(async () => {
	platform = installChatPlatform([
		chatSession('s-a1', 'ws-a', '2026-01-02T00:00:00.000Z'),
		chatSession('s-a2', 'ws-a', '2026-01-01T00:00:00.000Z'),
		chatSession('s-b', 'ws-b'),
	]);
	await startChatRouter('/workstreams/ws-a');
	releaseAgentEvents = connectAgentEventsHook();
	await sessionActivation.refreshSessionTabs('ws-a');
});

afterEach(async () => {
	releaseAgentEvents?.();
	releaseAgentEvents = null;
	vi.restoreAllMocks();
	await resetChatState();
});

describe('cold chat activation', () => {
	it('overlaps native activation, durable replay, and route synchronization', async () => {
		const phases = measuredPhases();
		const activation = gateActivation('s-a2');
		const replay = gateReplay('s-a2');
		const routeSync = holdNavigation((url) => url.searchParams.get('agent') === 's-a2');

		const activated = sessionActivation.activate('s-a2', 'ws-a');

		await vi.waitFor(() => {
			expect(activation.calls()).toBe(1);
			expect(replay.started()).toBe(true);
			expect(routeSync.started()).toBe(true);
		});
		expect(phases).toEqual([
			{ label: 'Activating workstream chat', target: 'ws-a' },
			{ label: 'Restoring conversation history', target: 'ws-a' },
			{ label: 'Synchronizing chat route', target: 'ws-a' },
		]);

		activation.resolve();
		replay.resolve();
		routeSync.release();

		await expect(activated).resolves.toBe(true);
		expect(chatSessionStore.sessionId).toBe('s-a2');
		expect(router.page.url.searchParams.get('agent')).toBe('s-a2');
	});

	it('keeps replayed history unpublished until every concurrent task succeeds', async () => {
		const activation = gateActivation('s-a2');
		const routeSync = holdNavigation((url) => url.searchParams.get('agent') === 's-a2');

		const activated = sessionActivation.activate('s-a2', 'ws-a');

		await vi.waitFor(() => expect(transcriptAggregate.envelopesFor('s-a2')).toHaveLength(2));
		expect(transcriptAggregate.isReady('s-a2')).toBe(false);

		activation.resolve();
		await vi.waitFor(() => expect(activation.calls()).toBe(1));
		for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
		expect(transcriptAggregate.isReady('s-a2')).toBe(false);

		routeSync.release();
		await expect(activated).resolves.toBe(true);
		expect(transcriptAggregate.isReady('s-a2')).toBe(true);
		expect(transcriptAggregate.isReadinessDeferred('s-a2')).toBe(false);
	});

	it('publishes nothing when one concurrent task fails', async () => {
		const activation = gateActivation('s-a2');

		const activated = sessionActivation.activate('s-a2', 'ws-a');
		await vi.waitFor(() => expect(transcriptAggregate.envelopesFor('s-a2')).toHaveLength(2));
		activation.reject(new Error('native activation failed'));

		await expect(activated).rejects.toThrow('native activation failed');
		expect(transcriptAggregate.isReady('s-a2')).toBe(false);
		expect(transcriptAggregate.isReadinessDeferred('s-a2')).toBe(false);
		expect(chatSessionStore.sessionId).toBeNull();
		expect(chatSessionStore.activatingSessionId).toBeNull();
	});

	it('reads an unknown chat through the named session-list phase', async () => {
		sessionsAggregate.reset();
		const phases: string[] = [];
		let listingDepth = 0;
		let listedInsidePhase = false;
		const measure = runtimeDiagnostics.measure.bind(runtimeDiagnostics);
		vi.spyOn(runtimeDiagnostics, 'measure').mockImplementation(async (input, operation) => {
			expect(input).toMatchObject({ category: 'runtime', budgetMs: 300, target: 'ws-a' });
			phases.push(input.label);
			if (input.label !== 'Listing workstream chats') return measure(input, operation);
			listingDepth += 1;
			try {
				return await measure(input, operation);
			} finally {
				listingDepth -= 1;
			}
		});
		const list = agentSessions.list.bind(agentSessions);
		vi.spyOn(agentSessions, 'list').mockImplementation((workstreamId) => {
			listedInsidePhase = listingDepth > 0;
			return list(workstreamId);
		});

		await expect(sessionActivation.activate('s-a2', 'ws-a')).resolves.toBe(true);

		expect(phases[0]).toBe('Listing workstream chats');
		expect(listedInsidePhase).toBe(true);
	});

	it('joins a background registration already running for the same chat', async () => {
		const background = deferred();
		const registered = vi.fn(() => background.promise);
		const activations = (): readonly unknown[] =>
			platform.calls.filter(({ command }) => command === 'chat.activate-session');
		void agentSessionPreactivation.preactivate('s-a2', registered);
		await vi.waitFor(() => expect(registered).toHaveBeenCalledTimes(1));

		const activated = sessionActivation.activate('s-a2', 'ws-a');
		for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
		expect(activations()).toEqual([]);

		background.resolve();
		await expect(activated).resolves.toBe(true);
		expect(registered).toHaveBeenCalledTimes(1);
		expect(activations()).toEqual([]);
	});
});

describe('an activation superseded by navigation', () => {
	it('does not commit when navigation to another workstream begins before it resolves', async () => {
		const activation = gateActivation('s-a2');
		const leaving = holdNavigation((url) => url.pathname === '/workstreams/ws-b');

		const activated = sessionActivation.activate('s-a2', 'ws-a');
		await vi.waitFor(() => expect(activation.calls()).toBe(1));
		void router.goto('/workstreams/ws-b');
		await vi.waitFor(() => expect(leaving.started()).toBe(true));
		expect(router.page.params.workstreamId).toBe('ws-a');

		activation.resolve();

		await expect(activated).resolves.toBe(false);
		expect(chatSessionStore.sessionId).toBeNull();
		expect(chatSessionStore.activatingSessionId).toBeNull();
		expect(transcriptAggregate.isReady('s-a2')).toBe(false);

		leaving.release();
		await settleChatRoute();
		expect(router.page.params.workstreamId).toBe('ws-b');
		expect(chatSessionStore.sessionId).toBeNull();
	});

	it('does not commit when navigation to another workstream lands before it resolves', async () => {
		const activation = gateActivation('s-a2');

		const activated = sessionActivation.activate('s-a2', 'ws-a');
		await vi.waitFor(() => expect(activation.calls()).toBe(1));
		await router.goto('/workstreams/ws-b');
		await settleChatRoute();

		activation.resolve();

		await expect(activated).resolves.toBe(false);
		expect(chatSessionStore.sessionId).toBeNull();
		expect(transcriptAggregate.isReady('s-a2')).toBe(false);
	});
});

describe('committing a sessionless presentation', () => {
	beforeEach(() => {
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-a', sessionId: 's-a1' };
		chatSessionStore.emptySessionMode = 'fresh';
	});

	it('retires the retained chat once the sessionless workstream is authoritative', () => {
		sessionActivation.commitSessionlessPresentation('ws-a');
		expect(transcriptAggregate.retainedPresentation).toBeNull();
	});

	it('keeps the retained chat for a workstream the route no longer shows', () => {
		sessionActivation.commitSessionlessPresentation('ws-b');
		expect(transcriptAggregate.retainedPresentation).not.toBeNull();
	});

	it('keeps the retained chat while navigation is leaving the workstream', async () => {
		const leaving = holdNavigation((url) => url.pathname === '/workstreams/ws-b');
		void router.goto('/workstreams/ws-b');
		await vi.waitFor(() => expect(leaving.started()).toBe(true));

		sessionActivation.commitSessionlessPresentation('ws-a');
		expect(transcriptAggregate.retainedPresentation).not.toBeNull();
	});

	it('keeps the retained chat while a session is still selected', () => {
		chatSessionStore.sessionId = 's-a1';
		sessionActivation.commitSessionlessPresentation('ws-a');
		expect(transcriptAggregate.retainedPresentation).not.toBeNull();
	});

	it('keeps the retained chat unless a fresh chat was asked for', () => {
		chatSessionStore.emptySessionMode = 'setup';
		sessionActivation.commitSessionlessPresentation('ws-a');
		expect(transcriptAggregate.retainedPresentation).not.toBeNull();

		chatSessionStore.createFreshSessionOnNextPrompt = true;
		sessionActivation.commitSessionlessPresentation('ws-a');
		expect(transcriptAggregate.retainedPresentation).toBeNull();
	});

	it('keeps the retained chat for a superseded selection', () => {
		const stale = chatSessionStore.beginSelection('ws-a', null);
		chatSessionStore.beginSelection('ws-a', null);

		sessionActivation.commitSessionlessPresentation('ws-a', stale);
		expect(transcriptAggregate.retainedPresentation).not.toBeNull();
	});
});
