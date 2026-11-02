import { agentSessionPreactivation } from '$lib/chat/domain/agent-session-preactivation';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { preferredVisualSessionsByWorkstream } from '$lib/chat/domain/workstream-visual-session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatSessionChanges } from '$lib/chat/infrastructure/services/chat-session-changes.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { captureRendererError } from '$shared/errors/renderer-error-sink';
import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
import { yieldToIdle } from '$shared/performance/yield-to-idle';
import {
	PERFORMANCE_BUDGETS,
	runtimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';

const SESSION_LIST_CONCURRENCY = 4;
const PRELOADED_WORKSTREAM_LIMIT = 8;
const PRELOADED_OPEN_CHAT_LIMIT = 8;
const PRELOADED_ATTENTION_CHAT_LIMIT = 16;
const WARM_INACTIVE_CHAT_LIMIT = 24;
const PRELOADED_TRANSCRIPT_BYTE_BUDGET = 512 * 1024;
const TRANSCRIPT_APPLY_CHUNK = 200;
const IDLE_TIMEOUT_MS = 200;
const EMPTY_WORKSTREAM_MEMORY_MS = 60_000;

type PreactivationTarget = Readonly<{ workstreamId: string; sessionId: string }>;

type TranscriptReplay = Readonly<{ promise: Promise<void>; controller: AbortController }>;

class WorkstreamChatsPreloader {
	#seq = 0;
	#cancelPreactivation: (() => void) | null = null;
	#cancelOpenChats: (() => void) | null = null;
	#cancelAttentionChats: (() => void) | null = null;
	readonly #replayedTranscripts = new Set<SessionId>();
	readonly #replaying = new Map<SessionId, TranscriptReplay>();
	readonly #warmOrder = new Map<SessionId, true>();
	readonly #listedWithoutChatsAt = new Map<string, number>();
	readonly #placedChats = new Set<SessionId>();
	#workstreamIds: readonly string[] = [];

	preload(workstreamIds: readonly string[]): void {
		this.#workstreamIds = workstreamIds;
		const seq = ++this.#seq;
		this.#cancel();
		void this.#hydrate(workstreamIds, seq);
	}

	placeChat(sessionId: SessionId): void {
		if (chatIsKnown(sessionId) || this.#placedChats.has(sessionId)) return;
		this.#placedChats.add(sessionId);
		void this.#place(this.#workstreamIds);
	}

	warm(workstreamId: string, sessionId: SessionId | null): void {
		void this.#warm(workstreamId, sessionId);
	}

	warmed(workstreamId: string, sessionId: SessionId): Promise<void> {
		return this.#warm(workstreamId, sessionId);
	}

	preloadAttentionChats(sessionIds: readonly SessionId[]): void {
		this.#cancelAttentionChats?.();
		this.#cancelAttentionChats = this.#replayAfterPaint(
			sessionIds.slice(0, PRELOADED_ATTENTION_CHAT_LIMIT),
		);
	}

	preloadOpenChats(currentSessionId: SessionId | null, sessionIds: readonly SessionId[]): void {
		if (currentSessionId) this.#touch(currentSessionId);
		this.#cancelOpenChats?.();
		this.#cancelOpenChats = this.#replayAfterPaint(sessionIds.slice(0, PRELOADED_OPEN_CHAT_LIMIT));
	}

	stop(): void {
		this.#cancel();
		this.#cancelOpenChats?.();
		this.#cancelOpenChats = null;
		this.#cancelAttentionChats?.();
		this.#cancelAttentionChats = null;
		this.#seq += 1;
	}

	forget(workstreamId: string, sessionIds: readonly SessionId[]): void {
		this.#listedWithoutChatsAt.delete(workstreamId);
		for (const sessionId of sessionIds) this.forgetChat(sessionId);
	}

	forgetChat(sessionId: SessionId): void {
		this.#replaying.get(sessionId)?.controller.abort();
		this.#replaying.delete(sessionId);
		this.#replayedTranscripts.delete(sessionId);
		this.#warmOrder.delete(sessionId);
	}

	#replayAfterPaint(sessionIds: readonly SessionId[]): (() => void) | null {
		if (sessionIds.length === 0) return null;
		const controller = new AbortController();
		const cancelAfterPaint = scheduleAfterSettledNavigationPaint(() => {
			if (controller.signal.aborted) return;
			void this.#replayUnheld(sessionIds, controller.signal);
		});
		return () => {
			controller.abort();
			cancelAfterPaint();
		};
	}

	async #replayUnheld(sessionIds: readonly SessionId[], signal: AbortSignal): Promise<void> {
		for (const sessionId of sessionIds) {
			if (signal.aborted) return;
			if (sessionsAggregate.isTranscriptHydrated(sessionId)) continue;
			await this.#replayTranscript(sessionId);
		}
	}

	async #hydrate(workstreamIds: readonly string[], seq: number): Promise<void> {
		const batches = await listSessionBatches(workstreamIds);
		if (seq !== this.#seq) return;
		this.#applyListing(workstreamIds, batches);
		this.#scheduleAfterPaint(workstreamIds, batches, seq);
	}

	async #place(workstreamIds: readonly string[]): Promise<void> {
		this.#applyListing(workstreamIds, await listSessionBatches(workstreamIds));
	}

	#applyListing(
		workstreamIds: readonly string[],
		batches: readonly (readonly ChatSessionSummary[])[],
	): void {
		batches.forEach((summaries, index) => {
			const workstreamId = workstreamIds[index];
			if (workstreamId) this.#rememberListing(workstreamId, summaries);
			hydrateSummaries(summaries);
		});
		agentLifecycleMonitor.flushKnownSessions();
	}

	#scheduleAfterPaint(
		workstreamIds: readonly string[],
		batches: readonly (readonly ChatSessionSummary[])[],
		seq: number,
	): void {
		const targets: PreactivationTarget[] = [];
		for (const summaries of batches) {
			const firstDurableSession = summaries.find(({ origin }) => origin === 'user');
			if (!firstDurableSession) continue;
			targets.push({
				workstreamId: firstDurableSession.workstreamId,
				sessionId: firstDurableSession.id,
			});
		}

		this.#cancel();
		const controller = new AbortController();
		const cancelAfterPaint = scheduleAfterSettledNavigationPaint(() => {
			if (controller.signal.aborted || seq !== this.#seq) return;
			for (const target of targets) {
				if (target.workstreamId === chatRoute.workstreamId) continue;
				void preactivate(target, controller.signal);
			}
			void this.#replayOpeningTranscripts(workstreamIds, controller.signal);
		});
		this.#cancelPreactivation = () => {
			controller.abort();
			cancelAfterPaint();
		};
	}

	async #replayOpeningTranscripts(
		workstreamIds: readonly string[],
		signal: AbortSignal,
	): Promise<void> {
		const others = workstreamIds.filter((workstreamId) => workstreamId !== chatRoute.workstreamId);
		for (const workstreamId of others.slice(0, PRELOADED_WORKSTREAM_LIMIT - 1)) {
			if (signal.aborted) return;
			const sessionId = openingSessionFor(workstreamId);
			if (!sessionId) continue;
			await chatSessionChanges.refreshKnown({ workstreamId, sessionId });
			if (signal.aborted || this.#holdsTranscript(sessionId)) continue;
			await this.#replayTranscript(sessionId);
		}
	}

	async #warm(workstreamId: string, requestedSessionId: SessionId | null): Promise<void> {
		try {
			const requestedUnknown =
				requestedSessionId !== null && !chatBelongsTo(requestedSessionId, workstreamId);
			if (!this.#knowsChatsOf(workstreamId) || requestedUnknown) {
				if (!requestedSessionId && this.#listedWithoutChatsRecently(workstreamId)) return;
				const summaries = await agentSessions.list(workstreamId);
				this.#rememberListing(workstreamId, summaries);
				hydrateSummaries(summaries);
			}
			const sessionId = requestedSessionId ?? openingSessionFor(workstreamId);
			if (!sessionId || !chatBelongsTo(sessionId, workstreamId)) return;
			await chatSessionChanges.refreshKnown({ workstreamId, sessionId });
			if (sessionsAggregate.isTranscriptHydrated(sessionId)) return;
			await this.#replayTranscript(sessionId);
		} catch (error) {
			captureRendererError('caught', error);
		}
	}

	#replayTranscript(sessionId: SessionId): Promise<void> {
		const inFlight = this.#replaying.get(sessionId);
		if (inFlight) return inFlight.promise;
		const controller = new AbortController();
		const stillWanted = (): boolean => !controller.signal.aborted && chatIsKnown(sessionId);
		const promise = (async (): Promise<void> => {
			try {
				const page = await agentSessions.listEventPage(sessionId, {
					afterSeq: 0,
					beforeSeq: null,
					byteBudget: PRELOADED_TRANSCRIPT_BYTE_BUDGET,
				});
				if (page.overBudget) return;
				const { envelopes } = page;
				for (let start = 0; start < envelopes.length; start += TRANSCRIPT_APPLY_CHUNK) {
					if (!stillWanted()) return;
					applyReplayedChunk(sessionId, envelopes.slice(start, start + TRANSCRIPT_APPLY_CHUNK));
					await yieldToIdle(IDLE_TIMEOUT_MS);
				}
				if (!stillWanted()) return;
				agentEventStream.adopt(sessionId, page);
				sessionsAggregate.markTranscriptHydrated(sessionId);
				this.#replayedTranscripts.add(sessionId);
				this.#touch(sessionId);
				this.#evictBeyondLimit();
			} catch (error) {
				captureRendererError('caught', error);
			} finally {
				if (this.#replaying.get(sessionId)?.controller === controller) {
					this.#replaying.delete(sessionId);
				}
			}
		})();
		this.#replaying.set(sessionId, { promise, controller });
		return promise;
	}

	#touch(sessionId: SessionId): void {
		this.#warmOrder.delete(sessionId);
		this.#warmOrder.set(sessionId, true);
	}

	#evictBeyondLimit(): void {
		const keep = new Set<SessionId | null | undefined>([
			chatRoute.requestedSessionId,
			chatSessionStore.sessionId,
			transcriptAggregate.targetPresentation?.sessionId,
			transcriptAggregate.retainedPresentation?.sessionId,
		]);
		const inactive = sessionsAggregate
			.hydratedTranscriptSessionIds()
			.filter(
				(sessionId) =>
					!keep.has(sessionId) &&
					sessionsAggregate.getSession(sessionId)?.workstreamId !== chatRoute.workstreamId,
			);
		const overflow = inactive.length - WARM_INACTIVE_CHAT_LIMIT;
		if (overflow <= 0) return;
		const recency = new Map(
			[...this.#warmOrder.keys()].map((sessionId, rank) => [sessionId, rank]),
		);
		const rankOf = (sessionId: SessionId): number => recency.get(sessionId) ?? -1;
		const oldestFirst = [...inactive].sort((left, right) => rankOf(left) - rankOf(right));
		for (const sessionId of oldestFirst.slice(0, overflow)) {
			this.forgetChat(sessionId);
			agentEventStream.forget(sessionId);
			sessionsAggregate.forgetTranscript(sessionId);
			transcriptAggregate.dropProjection(sessionId);
		}
	}

	#knowsChatsOf(workstreamId: string): boolean {
		return sessionsAggregate
			.listSessions()
			.some((session) => session.workstreamId === workstreamId);
	}

	#listedWithoutChatsRecently(workstreamId: string): boolean {
		const listedAt = this.#listedWithoutChatsAt.get(workstreamId);
		return listedAt !== undefined && Date.now() - listedAt < EMPTY_WORKSTREAM_MEMORY_MS;
	}

	#rememberListing(workstreamId: string, summaries: readonly ChatSessionSummary[]): void {
		if (summaries.length === 0) this.#listedWithoutChatsAt.set(workstreamId, Date.now());
		else this.#listedWithoutChatsAt.delete(workstreamId);
	}

	#holdsTranscript(sessionId: SessionId): boolean {
		return (
			this.#replayedTranscripts.has(sessionId) && sessionsAggregate.isTranscriptHydrated(sessionId)
		);
	}

	#cancel(): void {
		this.#cancelPreactivation?.();
		this.#cancelPreactivation = null;
	}
}

function chatIsKnown(sessionId: SessionId): boolean {
	const workstreamId = sessionsAggregate.getSession(sessionId)?.workstreamId;
	return workstreamId !== undefined && workstreamId !== '_unknown';
}

function chatBelongsTo(sessionId: SessionId, workstreamId: string): boolean {
	return sessionsAggregate.getSession(sessionId)?.workstreamId === workstreamId;
}

function openingSessionFor(workstreamId: string): SessionId | null {
	return (
		sessionsAggregate.openingSessionFor(workstreamId) ??
		preferredVisualSessionsByWorkstream(sessionsAggregate.listSessions()).get(workstreamId)?.id ??
		null
	);
}

function applyReplayedChunk(sessionId: SessionId, chunk: readonly EventEnvelope[]): void {
	sessionsAggregate.applyEventBatch(chunk);
	if (transcriptAggregate.hasProjection(sessionId)) transcriptAggregate.append(chunk);
}

function hydrateSummaries(summaries: readonly ChatSessionSummary[]): void {
	for (const summary of summaries) {
		sessionsAggregate.hydrateSession({
			sessionId: summary.id,
			workstreamId: summary.workstreamId,
			displayName: summary.displayName,
			provider: summary.provider,
			model: summary.model,
			status: summary.status,
			startedAt: summary.startedAt,
			origin: summary.origin,
		});
	}
}

async function listSessionBatches(
	workstreamIds: readonly string[],
): Promise<ChatSessionSummary[][]> {
	const batches: ChatSessionSummary[][] = Array.from({ length: workstreamIds.length }, () => []);
	let nextIndex = 0;
	async function listNext(): Promise<void> {
		while (nextIndex < workstreamIds.length) {
			const index = nextIndex++;
			const workstreamId = workstreamIds[index];
			if (workstreamId === undefined) break;
			try {
				batches[index] = await agentSessions.list(workstreamId);
			} catch {
				batches[index] = [];
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(SESSION_LIST_CONCURRENCY, workstreamIds.length) }, () =>
			listNext(),
		),
	);
	return batches;
}

async function preactivate(target: PreactivationTarget, signal: AbortSignal): Promise<void> {
	try {
		await agentSessionPreactivation.preactivate(
			target.sessionId,
			(sessionId) =>
				runtimeDiagnostics.measure(
					{
						category: 'runtime',
						label: 'Preactivating workstream chat',
						budgetMs: PERFORMANCE_BUDGETS.agentSessionStartMs,
						target: target.workstreamId,
					},
					() => agentSessions.activate(sessionId),
				),
			{ signal },
		);
	} catch (error) {
		captureRendererError('caught', error);
	}
}

export const workstreamChatsPreloader = new WorkstreamChatsPreloader();
