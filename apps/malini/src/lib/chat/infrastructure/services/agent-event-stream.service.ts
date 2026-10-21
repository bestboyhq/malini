import type { AgentEventSink } from '$lib/chat/domain/agent-event-sink';
import type { EventPage } from '$lib/chat/domain/event-page';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { transcriptHistoryAggregate } from '$lib/chat/infrastructure/aggregates/transcript-history.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { createEventStream } from '$lib/chat/infrastructure/services/event-stream.service';
import { planUsageStore } from '$lib/chat/infrastructure/stores/plan-usage.store.svelte';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

type EventStreamHandle = ReturnType<typeof createEventStream>;

const TRANSCRIPT_PAGE_BYTE_BUDGET = 512 * 1024;

class AgentEventStreamService {
	#stream: EventStreamHandle | null = null;
	#start: Promise<void> | null = null;
	#sink: AgentEventSink | null = null;
	#listenerError: string | null = null;
	#holders = 0;

	setSink(sink: AgentEventSink | null): void {
		this.#sink = sink;
	}

	hold(sink: AgentEventSink): void {
		this.#holders += 1;
		this.#sink = sink;
		this.ensure();
	}

	async __resetForTests(): Promise<void> {
		this.#holders = 0;
		this.#sink = null;
		await this.dispose();
	}

	async letGo(): Promise<void> {
		this.#holders = Math.max(0, this.#holders - 1);
		if (this.#holders > 0) return;
		this.#sink = null;
		await this.dispose();
	}

	get listenerError(): string | null {
		return this.#listenerError;
	}

	ensure(): EventStreamHandle {
		if (this.#stream) return this.#stream;
		const stream = createEventStream((envelope) => this.#deliver([envelope]), {
			replay: (sessionId, range) => agentSessions.listEventPage(sessionId, range),
			tailByteBudget: TRANSCRIPT_PAGE_BYTE_BUDGET,
			pageByteBudget: TRANSCRIPT_PAGE_BYTE_BUDGET,
			onHistoryComplete: (sessionId, complete) => {
				transcriptHistoryAggregate.setComplete(sessionId, complete);
			},
			onReplayBatch: (envelopes) => {
				this.#deliver(envelopes);
			},
			onLiveBatch: (envelopes) => {
				this.#deliver(envelopes);
			},
			onListenerState: (state) => {
				if (state.phase === 'ready') {
					this.#listenerError = null;
					return;
				}
				if (state.phase === 'failed') {
					this.#listenerError = state.error ?? 'native listener did not connect';
				}
			},
			replayTimeoutMs: 15_000,
			onEphemeralBatch: (envelopes) => {
				if (envelopes.length === 0) return;
				streamingStore.applyEphemeralBatch(envelopes);
				planUsageStore.observe(envelopes);
			},
		});
		this.#stream = stream;
		return stream;
	}

	async ensureStarted(): Promise<EventStreamHandle> {
		const stream = this.ensure();
		this.#start ??= stream.start();
		try {
			await this.#start;
			return stream;
		} catch (error) {
			if (this.#stream === stream) this.#start = null;
			const detail =
				this.#listenerError ?? (error instanceof Error ? error.message : String(error));
			throw new Error(
				`Live conversation updates are unavailable. Retry session to reconnect. ${detail}`,
			);
		}
	}

	async hydrate(sessionId: SessionId): Promise<void> {
		const stream = await this.ensureStarted();
		await stream.hydrate(sessionId);
	}

	forget(sessionId: SessionId): void {
		this.#stream?.forget(sessionId);
	}

	adopt(sessionId: SessionId, page: EventPage): void {
		this.ensure().adopt(sessionId, page);
	}

	async restart(): Promise<void> {
		const previous = this.#stream;
		this.#stream = null;
		this.#start = null;
		transcriptHistoryAggregate.clear();
		await previous?.dispose();
	}

	async dispose(): Promise<void> {
		const previous = this.#stream;
		this.#stream = null;
		this.#start = null;
		this.#listenerError = null;
		transcriptHistoryAggregate.clear();
		await previous?.dispose();
	}

	#deliver(envelopes: readonly EventEnvelope[]): void {
		this.#sink?.appendEnvelopes(envelopes);
	}
}

export const agentEventStream = new AgentEventStreamService();
