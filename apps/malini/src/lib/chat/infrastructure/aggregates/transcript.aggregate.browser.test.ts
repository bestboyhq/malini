import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendEnvelopesCommand } from '$lib/chat/application/commands/append-envelopes.command';
import {
	envelope,
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { presentedTranscriptQuery } from '$lib/chat/application/queries/presented-transcript.query.svelte';
import { CanonicalEnvelopeIndex } from '$lib/chat/domain/canonical-envelope-index';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { router } from '$shared/router/hash-router.svelte';
import { sessionsAggregate } from './sessions.aggregate.svelte';
import { transcriptAggregate } from './transcript.aggregate.svelte';

function cacheSession(
	sessionId: string,
	workstreamId: string,
	options: { startedAt?: string; envelopes?: number; hydrated?: boolean } = {},
): void {
	sessionsAggregate.ensureSession({
		sessionId,
		workstreamId,
		model: null,
		startedAt: options.startedAt ?? '2026-01-01T00:00:00.000Z',
	});
	const count = options.envelopes ?? 2;
	sessionsAggregate.applyEventBatch(
		Array.from({ length: count }, (_, index) => envelope(sessionId, index + 1)),
	);
	if (options.hydrated ?? true) sessionsAggregate.markTranscriptHydrated(sessionId);
}

async function routeTo(path: string): Promise<void> {
	await router.goto(path);
	await settleChatRoute();
}

beforeEach(async () => {
	await startChatRouter('/workstreams/ws-a');
});

afterEach(async () => {
	vi.restoreAllMocks();
	await resetChatState();
});

describe('the transcript projection before first paint', () => {
	it('projects only the visible chat and leaves every other chat for later', () => {
		cacheSession('s-a-old', 'ws-a', { startedAt: '2026-01-01T00:00:00.000Z' });
		cacheSession('s-a-new', 'ws-a', { startedAt: '2026-01-02T00:00:00.000Z' });
		cacheSession('s-b', 'ws-b');
		const listEnvelopes = vi.spyOn(sessionsAggregate, 'listEnvelopesFor');

		expect(transcriptAggregate.seedProjection('ws-a', null)).toBe('s-a-new');
		expect(Object.keys(transcriptAggregate.envelopesBySession)).toEqual(['s-a-new']);
		expect(listEnvelopes.mock.calls).toEqual([['s-a-new']]);

		expect(transcriptAggregate.seedProjection('ws-a', 's-a-old')).toBe('s-a-old');
		expect(Object.keys(transcriptAggregate.envelopesBySession)).toEqual(['s-a-old']);

		expect(transcriptAggregate.seedProjection('ws-a', 's-b')).toBe('s-a-new');
		expect(Object.keys(transcriptAggregate.envelopesBySession)).toEqual(['s-a-new']);

		transcriptAggregate.ensureProjection('s-a-old');
		expect(Object.keys(transcriptAggregate.envelopesBySession).sort()).toEqual([
			's-a-new',
			's-a-old',
		]);
		expect(transcriptAggregate.envelopesFor('s-a-old')).toEqual(
			sessionsAggregate.listEnvelopesFor('s-a-old'),
		);
	});

	it('publishes a restored chat as ready only when its transcript is known', () => {
		cacheSession('s-cold', 'ws-a', { envelopes: 0, hydrated: false });
		transcriptAggregate.seedProjection('ws-a', 's-cold');
		expect(transcriptAggregate.isReady('s-cold')).toBe(false);
		expect(transcriptAggregate.retainedPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-cold',
		});

		cacheSession('s-empty', 'ws-a', { envelopes: 0, hydrated: true });
		transcriptAggregate.seedProjection('ws-a', 's-empty');
		expect(transcriptAggregate.isReady('s-empty')).toBe(true);

		cacheSession('s-warm', 'ws-a', { envelopes: 2, hydrated: false });
		transcriptAggregate.seedProjection('ws-a', 's-warm');
		expect(transcriptAggregate.isReady('s-warm')).toBe(true);
		expect(sessionsAggregate.isTranscriptHydrated('s-warm')).toBe(false);
	});

	it('clears the retained presentation when the workstream has no chat to restore', () => {
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-b', sessionId: 's-b' };

		expect(transcriptAggregate.seedProjection('ws-a', null)).toBeNull();
		expect(transcriptAggregate.retainedPresentation).toBeNull();
		expect(transcriptAggregate.envelopesBySession).toEqual({});
	});
});

describe('the transcript target presentation', () => {
	it('targets only a ready projection owned by the routed workstream', async () => {
		cacheSession('s-a', 'ws-a');
		cacheSession('s-b', 'ws-b');
		transcriptAggregate.ensureProjection('s-a');
		transcriptAggregate.ensureProjection('s-b');
		transcriptAggregate.markReady('s-b');
		chatSessionStore.sessionId = 's-b';
		flushSync();
		expect(transcriptAggregate.targetPresentation).toBeNull();

		await routeTo('/workstreams/ws-a?agent=s-b');
		expect(transcriptAggregate.targetPresentation).toBeNull();

		await routeTo('/workstreams/ws-a?agent=s-a');
		expect(transcriptAggregate.targetPresentation).toBeNull();

		transcriptAggregate.markReady('s-a');
		flushSync();
		expect(transcriptAggregate.targetPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a',
		});
	});

	it('trusts the remembered owner over a session record from another workstream', () => {
		cacheSession('s-moved', 'ws-b');
		transcriptAggregate.ensureProjection('s-moved');
		transcriptAggregate.markReady('s-moved');
		chatSessionStore.sessionId = 's-moved';
		flushSync();
		expect(transcriptAggregate.targetPresentation).toBeNull();

		transcriptAggregate.rememberOwner('s-moved', 'ws-a');
		flushSync();
		expect(transcriptAggregate.targetPresentation).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-moved',
		});
	});

	it('presents the target, else the retained chat of the routed workstream once it is ready, never another workstream’s', () => {
		cacheSession('s-a', 'ws-a');
		cacheSession('s-a2', 'ws-a');
		cacheSession('s-b', 'ws-b');
		transcriptAggregate.ensureProjection('s-b');
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-b', sessionId: 's-b' };
		flushSync();

		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: 'ws-a',
			sessionId: null,
			envelopes: [],
		});

		transcriptAggregate.ensureProjection('s-a2');
		transcriptAggregate.retainedPresentation = { workstreamId: 'ws-a', sessionId: 's-a2' };
		flushSync();

		expect(presentedTranscriptQuery.data.sessionId).toBeNull();

		transcriptAggregate.markReady('s-a2');
		flushSync();

		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a2',
			envelopes: sessionsAggregate.listEnvelopesFor('s-a2'),
		});

		transcriptAggregate.ensureProjection('s-a');
		transcriptAggregate.markReady('s-a');
		chatSessionStore.sessionId = 's-a';
		flushSync();

		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: 'ws-a',
			sessionId: 's-a',
			envelopes: sessionsAggregate.listEnvelopesFor('s-a'),
		});
	});
});

describe('restoring a cached workstream transcript', () => {
	it('adopts the cached transcript without rescanning a projection that already exists', () => {
		cacheSession('s-a', 'ws-a');
		const projected = [envelope('s-a', 1)];
		transcriptAggregate.adoptProjection('s-a', projected);
		const projection = transcriptAggregate.envelopesBySession['s-a'];
		const resetIndex = vi.spyOn(CanonicalEnvelopeIndex.prototype, 'reset');

		expect(transcriptAggregate.restoreCached('ws-a', null)).toBe('s-a');

		expect(transcriptAggregate.envelopesBySession['s-a']).toBe(projection);
		expect(resetIndex).not.toHaveBeenCalled();
		expect(transcriptAggregate.isReady('s-a')).toBe(true);
		expect(transcriptAggregate.ownerOf('s-a')).toBe('ws-a');
	});

	it('projects the cached transcript when none exists yet', () => {
		cacheSession('s-a', 'ws-a');
		const resetIndex = vi.spyOn(CanonicalEnvelopeIndex.prototype, 'reset');

		expect(transcriptAggregate.restoreCached('ws-a', 's-a')).toBe('s-a');

		expect(transcriptAggregate.envelopesFor('s-a')).toEqual(
			sessionsAggregate.listEnvelopesFor('s-a'),
		);
		expect(resetIndex).not.toHaveBeenCalled();
		expect(transcriptAggregate.isReady('s-a')).toBe(true);
	});

	it('refuses a requested chat that belongs to another workstream', () => {
		cacheSession('s-a', 'ws-a');
		cacheSession('s-b', 'ws-b');

		expect(transcriptAggregate.restoreCached('ws-a', 's-b')).toBeNull();
		expect(transcriptAggregate.hasProjection('s-b')).toBe(false);
		expect(transcriptAggregate.isReady('s-b')).toBe(false);
	});

	it('names an unhydrated chat without presenting a transcript it does not have', () => {
		cacheSession('s-cold', 'ws-a', { hydrated: false });

		expect(transcriptAggregate.restoreCached('ws-a', null)).toBe('s-cold');
		expect(transcriptAggregate.hasProjection('s-cold')).toBe(false);
		expect(transcriptAggregate.isReady('s-cold')).toBe(false);
	});
});

describe('deferred transcript readiness', () => {
	it('keeps streamed envelopes unpublished until every deferral is released', () => {
		transcriptAggregate.deferReadiness('s-a');
		transcriptAggregate.deferReadiness('s-a');

		appendEnvelopesCommand([envelope('s-a', 1)]);
		expect(transcriptAggregate.envelopesFor('s-a')).toHaveLength(1);
		expect(transcriptAggregate.isReady('s-a')).toBe(false);

		transcriptAggregate.releaseReadiness('s-a');
		appendEnvelopesCommand([envelope('s-a', 2)]);
		expect(transcriptAggregate.isReady('s-a')).toBe(false);

		transcriptAggregate.releaseReadiness('s-a');
		expect(transcriptAggregate.isReadinessDeferred('s-a')).toBe(false);
		appendEnvelopesCommand([envelope('s-a', 3)]);
		expect(transcriptAggregate.isReady('s-a')).toBe(true);
	});
});
