import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chatSession,
	holdNavigation,
	installChatPlatform,
	resetChatState,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';
import { router } from '$shared/router/hash-router.svelte';
import { agentSessions } from './agent-sessions.service';
import { chatBootstrap } from './chat-bootstrap.service';

function clearsSessionParam(workstreamId: string): (url: URL) => boolean {
	return (url) => url.pathname === `/workstreams/${workstreamId}` && !url.searchParams.has('agent');
}

beforeEach(() => {
	installChatPlatform([chatSession('s-a', 'ws-a'), chatSession('s-b', 'ws-b')]);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await resetChatState();
});

describe('bootstrapping a workstream without chats', () => {
	beforeEach(async () => {
		await startChatRouter('/workstreams/ws-empty?agent=s-gone');
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-a', sessionId: 's-a' };
	});

	it('retires the retained chat only after the stale chat URL is cleared', async () => {
		const clearing = holdNavigation(clearsSessionParam('ws-empty'));

		const booted = chatBootstrap.run('ws-empty', chatSessionStore.nextBootstrapSeq());
		await vi.waitFor(() => expect(clearing.started()).toBe(true));
		expect(chatSessionStore.createFreshSessionOnNextPrompt).toBe(true);
		expect(transcriptAggregate.retainedPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a',
		});

		clearing.release();
		await booted;

		expect(router.page.url.searchParams.has('agent')).toBe(false);
		expect(transcriptAggregate.retainedPresentation).toBeNull();
		expect(chatSessionStore.sessionId).toBeNull();
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('keeps the retained chat when navigation leaves before the URL is cleared', async () => {
		const clearing = holdNavigation(clearsSessionParam('ws-empty'));
		const leaving = holdNavigation((url) => url.pathname === '/workstreams/ws-a');

		const booted = chatBootstrap.run('ws-empty', chatSessionStore.nextBootstrapSeq());
		await vi.waitFor(() => expect(clearing.started()).toBe(true));
		void router.goto('/workstreams/ws-a');
		await vi.waitFor(() => expect(leaving.started()).toBe(true));
		clearing.release();
		await booted;

		expect(transcriptAggregate.retainedPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a',
		});
		leaving.release();
	});

	it('keeps the retained chat when a newer selection starts before the URL is cleared', async () => {
		const clearing = holdNavigation(clearsSessionParam('ws-empty'));

		const booted = chatBootstrap.run('ws-empty', chatSessionStore.nextBootstrapSeq());
		await vi.waitFor(() => expect(clearing.started()).toBe(true));
		chatSessionStore.beginSelection('ws-empty', null);
		clearing.release();
		await booted;

		expect(router.page.url.searchParams.has('agent')).toBe(false);
		expect(transcriptAggregate.retainedPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a',
		});
	});
});

describe('bootstrap telemetry', () => {
	it('measures the exact-target session list read as a named runtime phase', async () => {
		await startChatRouter('/workstreams/ws-a');
		const phases: Array<{ label: string; target: string | undefined }> = [];
		let listingDepth = 0;
		let listedInsidePhase = false;
		const measure = runtimeDiagnostics.measure.bind(runtimeDiagnostics);
		vi.spyOn(runtimeDiagnostics, 'measure').mockImplementation(async (input, operation) => {
			expect(input).toMatchObject({ category: 'runtime', budgetMs: 300 });
			phases.push({ label: input.label, target: input.target });
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
			listedInsidePhase = listingDepth > 0 && workstreamId === 'ws-a';
			return list(workstreamId);
		});

		await chatBootstrap.run('ws-a', chatSessionStore.nextBootstrapSeq());

		expect(listedInsidePhase).toBe(true);
		expect(phases).toEqual([
			{ label: 'Listing workstream chats', target: 'ws-a' },
			{ label: 'Activating workstream chat', target: 'ws-a' },
			{ label: 'Restoring conversation history', target: 'ws-a' },
			{ label: 'Synchronizing chat route', target: 'ws-a' },
		]);
		expect(chatSessionStore.sessionId).toBe('s-a');
	});
});
