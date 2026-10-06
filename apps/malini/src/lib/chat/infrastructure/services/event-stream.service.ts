import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { EphemeralEnvelope } from '$lib/chat/domain/ephemeral-envelope';
import { agentEvents } from '$lib/chat/infrastructure/services/agent-events.service';

type EnvelopeListener = (envelope: EventEnvelope) => void;

type LiveEnvelopeListener = (envelope: EventEnvelope | null) => void;

type EphemeralListener = (envelope: EphemeralEnvelope) => void;

type EventHydrationProgress = {
	sessionId: SessionId;
	phase: 'fetching' | 'applying' | 'complete' | 'failed';
	eventCount: number;
	error?: string;
};

type EventListenerState = {
	phase: 'connecting' | 'ready' | 'failed';
	error?: string;
};

export class EventReplayTimeoutError extends Error {
	constructor(
		readonly sessionId: SessionId,
		readonly timeoutMs: number,
	) {
		super(`Conversation history did not respond within ${Math.ceil(timeoutMs / 1_000)}s`);
		this.name = 'EventReplayTimeoutError';
	}
}

type EventStreamOptions = {
	listen?: (handler: LiveEnvelopeListener) => () => void;
	replay?: (sessionId: SessionId, afterSeq: number) => Promise<readonly EventEnvelope[]>;
	onReplayBatch?: (envelopes: readonly EventEnvelope[]) => void | Promise<void>;
	onLiveBatch?: (envelopes: readonly EventEnvelope[]) => void;
	liveBatchWindowMs?: number;
	onHydrationProgress?: (progress: EventHydrationProgress) => void;
	onListenerState?: (state: EventListenerState) => void;
	replayTimeoutMs?: number;
	onEphemeral?: EphemeralListener;
	onEphemeralBatch?: (envelopes: readonly EphemeralEnvelope[]) => void;
	ephemeralBatchWindowMs?: number;
};

type EventStreamStats = {
	replayed: number;
	live: number;
	dropped: number;
	ephemeral: number;
};

type EventStreamHandle = {
	dispose(): Promise<void>;
	pushReplay(envelopes: readonly EventEnvelope[]): Promise<number>;
	start(): Promise<void>;
	isStarted(): boolean;
	stats(): EventStreamStats;
	lastSeenSeq(sessionId: SessionId): number;
	hydrate(sessionId: SessionId): Promise<void>;
};

export function createEventStream(
	listener: EnvelopeListener,
	options: EventStreamOptions = {},
): EventStreamHandle {
	let unlisten: (() => void) | null = null;
	let started = false;
	let disposed = false;

	const highestSeenSeq: Record<SessionId, number> = {};
	const deliveredSeqs: Record<SessionId, Set<number>> = {};
	let replayed = 0;
	let live = 0;
	let dropped = 0;
	let ephemeralCount = 0;
	const liveBatchWindowMs = Math.max(0, options.liveBatchWindowMs ?? 16);
	let pendingLiveBatch: EventEnvelope[] = [];
	let liveBatchTimer: ReturnType<typeof setTimeout> | null = null;
	const ephemeralBatchWindowMs = Math.max(0, options.ephemeralBatchWindowMs ?? 16);
	let pendingEphemeralBatch: EphemeralEnvelope[] = [];
	let ephemeralBatchTimer: ReturnType<typeof setTimeout> | null = null;
	const replayTimeoutMs = Math.max(1, options.replayTimeoutMs ?? 15_000);
	const hydratingSessions = new Set<SessionId>();
	const hydratedSessions = new Set<SessionId>();
	const pendingBySession: Record<SessionId, EventEnvelope[]> = {};
	const hydratingPromises: Map<SessionId, Promise<void>> = new Map();

	const registerEnvelope = (env: EventEnvelope, source: 'replay' | 'live'): boolean => {
		if (disposed) return false;
		if (!env || typeof env !== 'object') {
			dropped += 1;
			return false;
		}
		const sessionId = env.sessionId;
		const seq = env.seq;
		if (typeof sessionId !== 'string' || typeof seq !== 'number') {
			dropped += 1;
			return false;
		}

		const delivered = deliveredSeqs[sessionId] ?? (deliveredSeqs[sessionId] = new Set());

		if (delivered.has(seq)) {
			dropped += 1;
			return false;
		}

		delivered.add(seq);
		highestSeenSeq[sessionId] = Math.max(highestSeenSeq[sessionId] ?? 0, seq);
		if (source === 'replay') {
			replayed += 1;
		} else {
			live += 1;
		}
		return true;
	};

	const handleEnvelope = (env: EventEnvelope, source: 'replay' | 'live'): void => {
		if (!registerEnvelope(env, source)) return;
		listener(env);
	};

	const flushLiveBatch = (): void => {
		if (liveBatchTimer !== null) {
			clearTimeout(liveBatchTimer);
			liveBatchTimer = null;
		}
		if (pendingLiveBatch.length === 0) return;
		const batch = pendingLiveBatch;
		pendingLiveBatch = [];
		options.onLiveBatch?.(batch);
	};

	const isLiveFlushBoundary = (envelope: EventEnvelope): boolean => {
		const type = envelope.event.type;
		return (
			type === 'run.started' ||
			type === 'approval.requested' ||
			type === 'run.completed' ||
			type === 'run.failed' ||
			type === 'checkpoint.restored' ||
			type === 'turn.superseded' ||
			type === 'turn.restored' ||
			type === 'run.obsoleted' ||
			type === 'run.restored' ||
			type === 'session.branched'
		);
	};

	const deliverLive = (envelope: EventEnvelope): void => {
		if (!registerEnvelope(envelope, 'live')) return;
		if (!options.onLiveBatch) {
			listener(envelope);
			return;
		}
		pendingLiveBatch.push(envelope);
		if (isLiveFlushBoundary(envelope)) {
			flushLiveBatch();
			return;
		}
		if (liveBatchTimer !== null) return;
		liveBatchTimer = setTimeout(flushLiveBatch, liveBatchWindowMs);
	};

	const flushEphemeralBatch = (): void => {
		if (ephemeralBatchTimer !== null) {
			clearTimeout(ephemeralBatchTimer);
			ephemeralBatchTimer = null;
		}
		if (pendingEphemeralBatch.length === 0) return;
		const batch = pendingEphemeralBatch;
		pendingEphemeralBatch = [];
		try {
			options.onEphemeralBatch?.(batch);
		} catch {}
	};

	const deliverEphemeral = (envelope: EphemeralEnvelope): void => {
		ephemeralCount += 1;
		if (!options.onEphemeralBatch) {
			options.onEphemeral?.(envelope);
			return;
		}
		pendingEphemeralBatch.push(envelope);
		if (ephemeralBatchTimer !== null) return;
		ephemeralBatchTimer = setTimeout(flushEphemeralBatch, ephemeralBatchWindowMs);
	};

	const handleLiveEnvelope = (env: EventEnvelope | null): void => {
		if (disposed) return;
		if (!env) {
			dropped += 1;
			return;
		}
		if (isEphemeralEnvelope(env)) {
			flushLiveBatch();
			deliverEphemeral(env);
			return;
		}
		flushEphemeralBatch();
		const sessionId = env.sessionId;
		if (hydratingSessions.has(sessionId)) {
			const buffered = pendingBySession[sessionId] ?? [];
			buffered.push(env);
			pendingBySession[sessionId] = buffered;
			return;
		}
		deliverLive(env);
	};

	const applyReplayBatch = async (
		envelopes: readonly EventEnvelope[],
		onAccepted?: (count: number) => void,
	): Promise<number> => {
		if (disposed) return 0;
		flushLiveBatch();
		flushEphemeralBatch();
		const accepted: EventEnvelope[] = [];
		const acceptedSeqs = new Map<SessionId, Set<number>>();
		const ordered = [...envelopes].sort((a, b) => a.seq - b.seq);
		for (const env of ordered) {
			if (isEphemeralEnvelope(env)) {
				deliverEphemeral(env);
				continue;
			}
			if (!env || typeof env !== 'object') {
				dropped += 1;
				continue;
			}
			const { sessionId, seq } = env;
			if (typeof sessionId !== 'string' || typeof seq !== 'number') {
				dropped += 1;
				continue;
			}
			const batchSeqs = acceptedSeqs.get(sessionId) ?? new Set<number>();
			acceptedSeqs.set(sessionId, batchSeqs);
			if (deliveredSeqs[sessionId]?.has(seq) || batchSeqs.has(seq)) {
				dropped += 1;
				continue;
			}
			batchSeqs.add(seq);
			accepted.push(env);
		}

		flushEphemeralBatch();
		onAccepted?.(accepted.length);
		if (accepted.length === 0) return 0;
		if (options.onReplayBatch) {
			await options.onReplayBatch(accepted);
			for (const env of accepted) registerEnvelope(env, 'replay');
		} else {
			for (const env of accepted) handleEnvelope(env, 'replay');
		}
		return accepted.length;
	};

	const reportHydration = (progress: EventHydrationProgress): void => {
		try {
			options.onHydrationProgress?.(progress);
		} catch {}
	};

	const reportListener = (state: EventListenerState): void => {
		try {
			options.onListenerState?.(state);
		} catch {}
	};

	async function hydrateSession(sessionId: SessionId): Promise<void> {
		if (disposed) return;
		if (!options.replay) return;

		const inFlight = hydratingPromises.get(sessionId);
		if (inFlight) {
			await inFlight;
			return;
		}

		const afterSeq = hydratedSessions.has(sessionId) ? (highestSeenSeq[sessionId] ?? 0) : 0;
		hydratingSessions.add(sessionId);
		if (!pendingBySession[sessionId]) {
			pendingBySession[sessionId] = [];
		}

		const promise = (async (): Promise<void> => {
			let replaySucceeded = false;
			let eventCount = 0;
			try {
				reportHydration({ sessionId, phase: 'fetching', eventCount: 0 });
				const envelopes = await withReplayDeadline(
					options.replay!(sessionId, afterSeq),
					sessionId,
					replayTimeoutMs,
				);
				if (disposed) return;
				eventCount = await applyReplayBatch(envelopes, (acceptedCount) => {
					reportHydration({
						sessionId,
						phase: 'applying',
						eventCount: acceptedCount,
					});
				});
				replaySucceeded = true;
				reportHydration({ sessionId, phase: 'complete', eventCount });
			} catch (error) {
				reportHydration({
					sessionId,
					phase: 'failed',
					eventCount,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			} finally {
				if (replaySucceeded) {
					hydratedSessions.add(sessionId);
					const buffered = pendingBySession[sessionId] ?? [];
					delete pendingBySession[sessionId];
					hydratingSessions.delete(sessionId);
					if (!disposed) {
						for (const env of buffered.sort((a, b) => a.seq - b.seq)) {
							handleLiveEnvelope(env);
						}
						flushLiveBatch();
					}
				}
			}
		})();

		hydratingPromises.set(sessionId, promise);
		try {
			await promise;
		} finally {
			hydratingPromises.delete(sessionId);
		}
	}

	const attachListener = (): void => {
		const listen = options.listen ?? defaultListen;
		unlisten = listen((env) => handleLiveEnvelope(env));
	};

	return {
		async dispose(): Promise<void> {
			flushLiveBatch();
			flushEphemeralBatch();
			started = false;
			disposed = true;
			if (unlisten) {
				try {
					unlisten();
				} catch {}
				unlisten = null;
			}
			for (const key of Object.keys(highestSeenSeq)) delete highestSeenSeq[key];
			for (const key of Object.keys(deliveredSeqs)) delete deliveredSeqs[key];
			for (const key of Object.keys(pendingBySession)) delete pendingBySession[key];
			hydratingSessions.clear();
			hydratedSessions.clear();
			hydratingPromises.clear();
		},
		async pushReplay(envelopes: readonly EventEnvelope[]): Promise<number> {
			return await applyReplayBatch(envelopes);
		},
		async start(): Promise<void> {
			if (started) return;
			disposed = false;
			reportListener({ phase: 'connecting' });
			try {
				attachListener();
				started = true;
				reportListener({ phase: 'ready' });
			} catch (error) {
				started = false;
				unlisten = null;
				reportListener({
					phase: 'failed',
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		},
		isStarted(): boolean {
			return started;
		},
		stats(): EventStreamStats {
			return { replayed, live, dropped, ephemeral: ephemeralCount };
		},
		lastSeenSeq(sessionId: SessionId): number {
			return highestSeenSeq[sessionId] ?? 0;
		},
		async hydrate(sessionId: SessionId): Promise<void> {
			await hydrateSession(sessionId);
		},
	};
}

async function withReplayDeadline<T>(
	operation: Promise<T>,
	sessionId: SessionId,
	timeoutMs: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new EventReplayTimeoutError(sessionId, timeoutMs)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function isEphemeralEnvelope(value: unknown): value is EphemeralEnvelope {
	return (
		typeof value === 'object' && value !== null && 'ephemeral' in value && value.ephemeral === true
	);
}

function defaultListen(handler: LiveEnvelopeListener): () => void {
	return agentEvents.subscribe(handler);
}
