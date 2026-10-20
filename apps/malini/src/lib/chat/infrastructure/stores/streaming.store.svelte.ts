import type { BackgroundWork } from '$lib/chat/domain/background-work';
import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import type { EphemeralEnvelope } from '$lib/chat/domain/ephemeral-envelope';
import type {
	FinalizedBlock,
	LiveToolInput,
	StreamingBlockKind,
	LiveContextUsage,
	StreamingBlock,
	StreamingIngestionStats,
} from '$lib/chat/domain/streaming-block';

type SessionBlocks = Record<string, StreamingBlock>;
type SessionToolInputs = Record<
	string,
	{ runId: RunId; toolCallId: string; name: string; json: string }
>;
type StreamDiscard = {
	readonly sessionId: SessionId;
	readonly blockKeys: readonly string[];
	readonly toolInputKeys: readonly string[];
};

export const LIVE_TOOL_INPUT_CAPTURE_CHARS = 2_001;

function blockKey(runId: RunId, contentId: string): string {
	return `${runId}:${contentId}`;
}

function toolInputKey(runId: RunId, toolCallId: string): string {
	return `${runId}:${toolCallId}`;
}

function withoutKeys<T>(
	record: Record<string, T> | undefined,
	keys: readonly string[],
): Record<string, T> | undefined {
	if (!record || !keys.some((key) => key in record)) return undefined;
	const rest = { ...record };
	for (const key of keys) delete rest[key];
	return rest;
}

function withoutRun<T extends { runId: RunId }>(
	record: Record<string, T> | undefined,
	runId: RunId | undefined,
): Record<string, T> | undefined {
	if (!record) return undefined;
	const entries = Object.entries(record);
	const kept = runId ? entries.filter(([, entry]) => entry.runId !== runId) : [];
	return kept.length === entries.length ? undefined : Object.fromEntries(kept);
}

const NO_BLOCKS: readonly StreamingBlock[] = [];
const NO_TOOL_INPUTS: readonly LiveToolInput[] = [];

function memoizedForRun<Source extends object, Value>(
	cache: WeakMap<Source, Map<RunId, Value>>,
	source: Source,
	runId: RunId,
	compute: () => Value,
): Value {
	let byRun = cache.get(source);
	if (!byRun) {
		byRun = new Map();
		cache.set(source, byRun);
	}
	const cached = byRun.get(runId);
	if (cached !== undefined) return cached;
	const value = compute();
	byRun.set(runId, value);
	return value;
}

class StreamingStore {
	#blocksBySession: Record<SessionId, SessionBlocks> = $state.raw({});
	#toolInputsBySession: Record<SessionId, SessionToolInputs> = $state.raw({});
	#liveContextBySession: Record<SessionId, LiveContextUsage> = $state.raw({});
	#liveBackgroundBySession: Record<SessionId, BackgroundWork> = $state.raw({});
	#blocksByRun = new WeakMap<SessionBlocks, Map<RunId, readonly StreamingBlock[]>>();
	#toolInputsByRun = new WeakMap<SessionToolInputs, Map<RunId, readonly LiveToolInput[]>>();
	#ingestionStats: StreamingIngestionStats = {
		trackedEnvelopes: 0,
		reactiveCommits: 0,
		toolInputCharsDropped: 0,
	};

	applyEphemeral(envelope: EphemeralEnvelope): void {
		this.applyEphemeralBatch([envelope]);
	}

	applyEphemeralBatch(envelopes: readonly EphemeralEnvelope[]): void {
		type BlockBatch = {
			sessionId: SessionId;
			runId: RunId;
			kind: StreamingBlockKind;
			contentId: string;
			chunks: string[];
		};
		type ToolBatch = {
			sessionId: SessionId;
			runId: RunId;
			toolCallId: string;
			name: string;
			chunks: string[];
			capturedLength: number;
			captureLimit: number;
			incomingLength: number;
		};

		const blocks = new Map<string, BlockBatch>();
		const tools = new Map<string, ToolBatch>();
		const liveContext = new Map<SessionId, LiveContextUsage>();
		const liveBackground = new Map<SessionId, BackgroundWork>();
		const discards: StreamDiscard[] = [];
		for (const envelope of envelopes) {
			const sessionId = envelope.sessionId;
			const event = envelope.event;
			switch (event.type) {
				case 'assistant.delta':
				case 'thinking.delta': {
					this.#ingestionStats.trackedEnvelopes += 1;
					const kind = event.type === 'assistant.delta' ? 'assistant' : 'thinking';
					const key = `${sessionId}\u0000${envelope.runId}\u0000${kind}\u0000${event.contentId}`;
					const batch = blocks.get(key);
					if (batch) batch.chunks.push(event.text);
					else {
						blocks.set(key, {
							sessionId,
							runId: envelope.runId,
							kind,
							contentId: event.contentId,
							chunks: [event.text],
						});
					}
					break;
				}
				case 'tool.input.delta': {
					this.#ingestionStats.trackedEnvelopes += 1;
					const key = `${sessionId}\u0000${envelope.runId}\u0000${event.toolCallId}`;
					let batch = tools.get(key);
					if (!batch) {
						const storedLength =
							this.#toolInputsBySession[sessionId]?.[toolInputKey(envelope.runId, event.toolCallId)]
								?.json.length ?? 0;
						batch = {
							sessionId,
							runId: envelope.runId,
							toolCallId: event.toolCallId,
							name: event.name,
							chunks: [],
							capturedLength: 0,
							captureLimit: Math.max(0, LIVE_TOOL_INPUT_CAPTURE_CHARS - storedLength),
							incomingLength: 0,
						};
						tools.set(key, batch);
					}
					batch.incomingLength += event.inputJsonDelta.length;
					const available = batch.captureLimit - batch.capturedLength;
					if (available > 0) {
						const captured = event.inputJsonDelta.slice(0, available);
						if (captured) batch.chunks.push(captured);
						batch.capturedLength += captured.length;
					}
					break;
				}
				case 'usage.updated': {
					if (event.contextTokens === undefined || !Number.isFinite(event.contextTokens)) break;
					if (event.contextTokens < 0) break;
					this.#ingestionStats.trackedEnvelopes += 1;
					liveContext.set(sessionId, {
						runId: envelope.runId,
						contextTokens: event.contextTokens,
						contextWindowTokens:
							event.contextWindowTokens !== undefined &&
							Number.isFinite(event.contextWindowTokens) &&
							event.contextWindowTokens > 0
								? event.contextWindowTokens
								: null,
					});
					break;
				}
				case 'stream.discarded':
					this.#ingestionStats.trackedEnvelopes += 1;
					discards.push({
						sessionId,
						blockKeys: event.contentIds.map((contentId) => blockKey(envelope.runId, contentId)),
						toolInputKeys: event.toolCallIds.map((toolCallId) =>
							toolInputKey(envelope.runId, toolCallId),
						),
					});
					break;
				case 'background.updated':
					liveBackground.set(sessionId, {
						runId: envelope.runId,
						waiting: event.waiting,
						tasks: event.tasks,
					});
					break;
				default:
					break;
			}
		}

		if (liveBackground.size > 0) {
			this.#liveBackgroundBySession = {
				...this.#liveBackgroundBySession,
				...Object.fromEntries(liveBackground),
			};
		}

		if (blocks.size > 0) {
			const nextBySession = { ...this.#blocksBySession };
			const writable = new Map<SessionId, SessionBlocks>();
			for (const batch of blocks.values()) {
				let sessionBlocks = writable.get(batch.sessionId);
				if (!sessionBlocks) {
					sessionBlocks = { ...(nextBySession[batch.sessionId] ?? {}) };
					writable.set(batch.sessionId, sessionBlocks);
					nextBySession[batch.sessionId] = sessionBlocks;
				}
				const key = blockKey(batch.runId, batch.contentId);
				const existing = sessionBlocks[key];
				const textChunk = batch.chunks.join('');
				sessionBlocks[key] = existing
					? {
							...existing,
							text: existing.text + textChunk,
							latestChunkLength: textChunk.length,
							revision: existing.revision + batch.chunks.length,
						}
					: {
							contentId: batch.contentId,
							runId: batch.runId,
							kind: batch.kind,
							text: textChunk,
							latestChunkLength: textChunk.length,
							revision: batch.chunks.length,
							startedAt: Date.now(),
						};
			}
			this.#blocksBySession = nextBySession;
			this.#ingestionStats.reactiveCommits += 1;
		}

		if (tools.size > 0) {
			const nextBySession = { ...this.#toolInputsBySession };
			const writable = new Map<SessionId, SessionToolInputs>();
			let changed = false;
			for (const batch of tools.values()) {
				const key = toolInputKey(batch.runId, batch.toolCallId);
				const existing = nextBySession[batch.sessionId]?.[key];
				const suffix = batch.chunks.join('');
				this.#ingestionStats.toolInputCharsDropped += batch.incomingLength - suffix.length;
				if (suffix.length === 0 && existing) continue;

				let sessionInputs = writable.get(batch.sessionId);
				if (!sessionInputs) {
					sessionInputs = { ...(nextBySession[batch.sessionId] ?? {}) };
					writable.set(batch.sessionId, sessionInputs);
					nextBySession[batch.sessionId] = sessionInputs;
				}
				sessionInputs[key] = {
					runId: batch.runId,
					toolCallId: batch.toolCallId,
					name: batch.name,
					json: `${existing?.json ?? ''}${suffix}`,
				};
				changed = true;
			}
			if (changed) {
				this.#toolInputsBySession = nextBySession;
				this.#ingestionStats.reactiveCommits += 1;
			}
		}

		if (liveContext.size > 0) {
			this.#liveContextBySession = {
				...this.#liveContextBySession,
				...Object.fromEntries(liveContext),
			};
			this.#ingestionStats.reactiveCommits += 1;
		}

		for (const discard of discards) this.#discard(discard);
	}

	#discard({ sessionId, blockKeys, toolInputKeys }: StreamDiscard): void {
		const blocks = withoutKeys(this.#blocksBySession[sessionId], blockKeys);
		if (blocks) this.#blocksBySession = { ...this.#blocksBySession, [sessionId]: blocks };
		const inputs = withoutKeys(this.#toolInputsBySession[sessionId], toolInputKeys);
		if (inputs) this.#toolInputsBySession = { ...this.#toolInputsBySession, [sessionId]: inputs };
	}

	ingestionStats(): StreamingIngestionStats {
		return { ...this.#ingestionStats };
	}

	finalizeBlock(sessionId: SessionId, runId: RunId, contentId: string): FinalizedBlock | null {
		const key = blockKey(runId, contentId);
		const sessionBlocks = this.#blocksBySession[sessionId];
		const block = sessionBlocks?.[key];
		if (!block) return null;

		const rest = { ...sessionBlocks };
		delete rest[key];
		this.#blocksBySession = { ...this.#blocksBySession, [sessionId]: rest };

		return {
			contentId: block.contentId,
			runId: block.runId,
			kind: block.kind,
			text: block.text,
			durationMs: Math.max(0, Date.now() - block.startedAt),
		};
	}

	finalizeToolInput(sessionId: SessionId, runId: RunId, toolCallId: string): string | null {
		const sessionInputs = this.#toolInputsBySession[sessionId];
		const key = toolInputKey(runId, toolCallId);
		const entry = sessionInputs?.[key];
		if (!entry) return null;

		const rest = { ...sessionInputs };
		delete rest[key];
		this.#toolInputsBySession = { ...this.#toolInputsBySession, [sessionId]: rest };
		return entry.json;
	}

	clearRun(sessionId: SessionId, runId?: RunId): void {
		const nextBlocks = withoutRun(this.#blocksBySession[sessionId], runId);
		if (nextBlocks) this.#blocksBySession = { ...this.#blocksBySession, [sessionId]: nextBlocks };

		const nextInputs = withoutRun(this.#toolInputsBySession[sessionId], runId);
		if (nextInputs) {
			this.#toolInputsBySession = { ...this.#toolInputsBySession, [sessionId]: nextInputs };
		}

		const liveContext = this.#liveContextBySession[sessionId];
		if (liveContext && (!runId || liveContext.runId === runId)) {
			const next = { ...this.#liveContextBySession };
			delete next[sessionId];
			this.#liveContextBySession = next;
		}
	}

	clearLiveBackground(sessionId: SessionId): void {
		if (!this.#liveBackgroundBySession[sessionId]) return;
		const next = { ...this.#liveBackgroundBySession };
		delete next[sessionId];
		this.#liveBackgroundBySession = next;
	}

	liveBackgroundFor(sessionId: SessionId): BackgroundWork | null {
		return this.#liveBackgroundBySession[sessionId] ?? null;
	}

	liveContextUsageFor(sessionId: SessionId): LiveContextUsage | null {
		return this.#liveContextBySession[sessionId] ?? null;
	}

	blocksFor(sessionId: SessionId): readonly StreamingBlock[] {
		const sessionBlocks = this.#blocksBySession[sessionId];
		return sessionBlocks ? Object.values(sessionBlocks) : [];
	}

	blocksForRun(sessionId: SessionId, runId: RunId): readonly StreamingBlock[] {
		const sessionBlocks = this.#blocksBySession[sessionId];
		if (!sessionBlocks) return NO_BLOCKS;
		return memoizedForRun(this.#blocksByRun, sessionBlocks, runId, () =>
			Object.values(sessionBlocks).filter((block) => block.runId === runId),
		);
	}

	toolInputJsonFor(sessionId: SessionId, runId: RunId, toolCallId: string): string | null {
		return this.#toolInputsBySession[sessionId]?.[toolInputKey(runId, toolCallId)]?.json ?? null;
	}

	toolInputsForRun(sessionId: SessionId, runId: RunId): readonly LiveToolInput[] {
		const sessionInputs = this.#toolInputsBySession[sessionId];
		if (!sessionInputs) return NO_TOOL_INPUTS;
		return memoizedForRun(this.#toolInputsByRun, sessionInputs, runId, () =>
			Object.values(sessionInputs)
				.filter((entry) => entry.runId === runId)
				.map((entry) => ({ toolCallId: entry.toolCallId, name: entry.name, json: entry.json })),
		);
	}

	reset(): void {
		this.#blocksBySession = {};
		this.#toolInputsBySession = {};
		this.#liveContextBySession = {};
		this.#liveBackgroundBySession = {};
		this.#ingestionStats = {
			trackedEnvelopes: 0,
			reactiveCommits: 0,
			toolInputCharsDropped: 0,
		};
	}
}

export const streamingStore = new StreamingStore();
