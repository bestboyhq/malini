import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { FinalizedStreamingThought } from '$lib/chat/domain/streaming-block';
import { IncrementalRunTimelineProjector } from './incremental-run-timeline';
import { IncrementalRenderProjector } from './render-projector';
import { coalesceAdjacentThoughts } from './render-state';
import {
	createStreamingEnvelopeCursor,
	takeUnprocessedEnvelopes,
} from './streaming-envelope-cursor';

export const SESSION_PROJECTOR_CACHE_MAX_ENTRIES = 32;

export type SessionProjectorPair = Readonly<{
	render: IncrementalRenderProjector;
	timeline: IncrementalRunTimelineProjector;
	streaming: IncrementalSessionStreamingProjector;
}>;

export type SessionStreamingProjectionSnapshot = Readonly<{
	revision: number;
	thoughtRevision: number;
	finalizedBlockKeys: ReadonlySet<string>;
	startedToolInputKeys: ReadonlySet<string>;
}>;

export type SessionStreamingProjectionStats = Readonly<{
	processedEnvelopeCount: number;
	projectionEnvelopeVisitCount: number;
	effectEnvelopeCount: number;
	membershipRebuildCount: number;
	unchangedSourceHits: number;
	pendingEffectCount: number;
}>;

type FinalizedThoughtOverride = Readonly<{
	thought: FinalizedStreamingThought;
	sourceEnvelope: EventEnvelope;
}>;

function envelopeKey(envelope: EventEnvelope): string {
	return `${envelope.sessionId}:${envelope.runId}:${envelope.seq}`;
}

function blockKey(sessionId: SessionId, runId: string, contentId: string): string {
	return `${sessionId}:${runId}:${contentId}`;
}

function toolInputKey(runId: string, toolCallId: string): string {
	return `${runId}:${toolCallId}`;
}

function thoughtKey(thought: FinalizedStreamingThought): string {
	return blockKey(thought.sessionId, thought.runId, thought.contentId);
}

function sameThought(left: FinalizedStreamingThought, right: FinalizedStreamingThought): boolean {
	return (
		left.seq === right.seq &&
		left.text === right.text &&
		left.durationSeconds === right.durationSeconds
	);
}

export class IncrementalSessionStreamingProjector {
	readonly #cursor = createStreamingEnvelopeCursor();
	readonly #finalizedBlockKeys = new Set<string>();
	readonly #startedToolInputKeys = new Set<string>();
	readonly #rawThoughtByKey = new Map<string, FinalizedStreamingThought>();
	readonly #finalizedThoughtOverridesByKey = new Map<string, FinalizedThoughtOverride>();
	readonly #rawThoughtsByRun = new Map<string, FinalizedStreamingThought[]>();
	readonly #visibleThoughtsByRun = new Map<string, readonly FinalizedStreamingThought[]>();
	#pendingEffects: EventEnvelope[] = [];
	#sourceLength = 0;
	#lastEnvelopeKey: string | null = null;
	#sourceReference: readonly EventEnvelope[] | null = null;
	#hasProjectedSource = false;
	#revision = 0;
	#thoughtRevision = 0;
	#processedEnvelopeCount = 0;
	#projectionEnvelopeVisitCount = 0;
	#effectEnvelopeCount = 0;
	#membershipRebuildCount = 0;
	#unchangedSourceHits = 0;
	#snapshot: SessionStreamingProjectionSnapshot = Object.freeze({
		revision: 0,
		thoughtRevision: 0,
		finalizedBlockKeys: this.#finalizedBlockKeys,
		startedToolInputKeys: this.#startedToolInputKeys,
	});

	project(envelopes: readonly EventEnvelope[]): SessionStreamingProjectionSnapshot {
		if (this.#sourceUnchanged(envelopes)) {
			this.#unchangedSourceHits += 1;
			return this.#snapshot;
		}

		const canAppend = this.#canAppend(envelopes);
		const unprocessed = takeUnprocessedEnvelopes(envelopes, this.#cursor);
		this.#processedEnvelopeCount += unprocessed.length;
		for (const envelope of unprocessed) this.#pendingEffects.push(envelope);

		if (this.#hasProjectedSource && !canAppend) {
			this.#rebuildMembership(envelopes);
			this.#projectionEnvelopeVisitCount += envelopes.length;
			this.#membershipRebuildCount += 1;
		} else {
			const appendStart = this.#hasProjectedSource ? this.#sourceLength : 0;
			this.#applyMembershipRange(envelopes, appendStart);
			this.#projectionEnvelopeVisitCount += envelopes.length - appendStart;
		}

		this.#sourceLength = envelopes.length;
		const lastEnvelope = envelopes[envelopes.length - 1];
		this.#lastEnvelopeKey = lastEnvelope ? envelopeKey(lastEnvelope) : null;
		this.#sourceReference = envelopes;
		this.#hasProjectedSource = true;
		this.#revision += 1;
		this.#publishSnapshot();
		return this.#snapshot;
	}

	takePendingEffects(): readonly EventEnvelope[] {
		if (this.#pendingEffects.length === 0) return [];
		const pending = this.#pendingEffects;
		this.#pendingEffects = [];
		this.#effectEnvelopeCount += pending.length;
		return pending;
	}

	finalizedThoughtsForRun(runId: string): readonly FinalizedStreamingThought[] {
		return this.#visibleThoughtsByRun.get(runId) ?? [];
	}

	recordFinalizedThought(
		thought: FinalizedStreamingThought,
		sourceEnvelope: EventEnvelope,
	): boolean {
		this.#finalizedThoughtOverridesByKey.set(thoughtKey(thought), {
			thought,
			sourceEnvelope,
		});
		if (!this.#upsertRawThought(thought)) return false;
		this.#publishThoughtsForRun(thought.runId);
		this.#thoughtRevision += 1;
		this.#publishSnapshot();
		return true;
	}

	stats(): SessionStreamingProjectionStats {
		return {
			processedEnvelopeCount: this.#processedEnvelopeCount,
			projectionEnvelopeVisitCount: this.#projectionEnvelopeVisitCount,
			effectEnvelopeCount: this.#effectEnvelopeCount,
			membershipRebuildCount: this.#membershipRebuildCount,
			unchangedSourceHits: this.#unchangedSourceHits,
			pendingEffectCount: this.#pendingEffects.length,
		};
	}

	#sourceUnchanged(envelopes: readonly EventEnvelope[]): boolean {
		if (
			!this.#hasProjectedSource ||
			envelopes !== this.#sourceReference ||
			envelopes.length !== this.#sourceLength
		) {
			return false;
		}
		const lastEnvelope = envelopes[envelopes.length - 1];
		return lastEnvelope === undefined || envelopeKey(lastEnvelope) === this.#lastEnvelopeKey;
	}

	#canAppend(envelopes: readonly EventEnvelope[]): boolean {
		if (!this.#hasProjectedSource || this.#sourceLength === 0) return true;
		if (envelopes.length < this.#sourceLength) return false;
		const formerLast = envelopes[this.#sourceLength - 1];
		if (formerLast === undefined || envelopeKey(formerLast) !== this.#lastEnvelopeKey) {
			return false;
		}
		if (envelopes === this.#sourceReference) {
			return true;
		}
		if (!this.#sourceReference) return false;
		for (let index = 0; index < this.#sourceLength; index += 1) {
			if (envelopes[index] !== this.#sourceReference[index]) return false;
		}
		return true;
	}

	#rebuildMembership(envelopes: readonly EventEnvelope[]): void {
		const previousThoughtRevision = this.#thoughtRevision;
		const canonicalEnvelopes = new Set(envelopes);
		const canonicalEnvelopeByKey = new Map(
			envelopes.map((envelope) => [envelopeKey(envelope), envelope] as const),
		);
		const remappedPendingEffects = new Map<string, EventEnvelope>();
		for (const pending of this.#pendingEffects) {
			const key = envelopeKey(pending);
			const canonical = canonicalEnvelopeByKey.get(key);
			if (canonical) remappedPendingEffects.set(key, canonical);
		}
		this.#pendingEffects = [...remappedPendingEffects.values()];
		this.#finalizedBlockKeys.clear();
		this.#startedToolInputKeys.clear();
		this.#rawThoughtByKey.clear();
		this.#rawThoughtsByRun.clear();
		this.#visibleThoughtsByRun.clear();
		this.#applyMembershipRange(envelopes, 0);
		for (const [key, override] of this.#finalizedThoughtOverridesByKey) {
			if (!canonicalEnvelopes.has(override.sourceEnvelope)) {
				this.#finalizedThoughtOverridesByKey.delete(key);
			}
		}
		if (this.#thoughtRevision === previousThoughtRevision) this.#thoughtRevision += 1;
	}

	#applyMembershipRange(envelopes: readonly EventEnvelope[], start: number): void {
		const changedThoughtRuns = new Set<string>();
		for (let index = start; index < envelopes.length; index += 1) {
			const envelope = envelopes[index];
			if (!envelope) continue;
			const event = envelope.event;
			if (event.type === 'assistant.message' && event.contentId) {
				this.#finalizedBlockKeys.add(blockKey(envelope.sessionId, envelope.runId, event.contentId));
			} else if (event.type === 'thinking.message') {
				this.#finalizedBlockKeys.add(blockKey(envelope.sessionId, envelope.runId, event.contentId));
				const durableThought: FinalizedStreamingThought = {
					sessionId: envelope.sessionId,
					runId: envelope.runId,
					contentId: event.contentId,
					seq: envelope.seq,
					text: event.text,
					durationSeconds: null,
				};
				const override = this.#finalizedThoughtOverridesByKey.get(thoughtKey(durableThought));
				if (
					this.#upsertRawThought(
						override !== undefined && override.sourceEnvelope === envelope
							? override.thought
							: durableThought,
					)
				) {
					changedThoughtRuns.add(envelope.runId);
				}
			} else if (event.type === 'tool.started' && event.toolCallId) {
				this.#startedToolInputKeys.add(toolInputKey(envelope.runId, event.toolCallId));
			}
		}
		for (const runId of changedThoughtRuns) this.#publishThoughtsForRun(runId);
		if (changedThoughtRuns.size > 0) this.#thoughtRevision += 1;
	}

	#upsertRawThought(thought: FinalizedStreamingThought): boolean {
		const key = thoughtKey(thought);
		const existing = this.#rawThoughtByKey.get(key);
		if (existing && sameThought(existing, thought)) return false;

		let raw = this.#rawThoughtsByRun.get(thought.runId);
		if (!raw) {
			raw = [];
			this.#rawThoughtsByRun.set(thought.runId, raw);
		}
		if (existing) {
			const existingIndex = raw.indexOf(existing);
			if (existingIndex >= 0) raw.splice(existingIndex, 1);
		}
		let low = 0;
		let high = raw.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			const candidate = raw[middle];
			if (
				candidate === undefined ||
				candidate.seq < thought.seq ||
				(candidate.seq === thought.seq && thoughtKey(candidate) < key)
			) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		raw.splice(low, 0, thought);
		this.#rawThoughtByKey.set(key, thought);
		return true;
	}

	#publishThoughtsForRun(runId: string): void {
		const raw = this.#rawThoughtsByRun.get(runId) ?? [];
		this.#visibleThoughtsByRun.set(runId, Object.freeze(coalesceAdjacentThoughts(raw)));
	}

	#publishSnapshot(): void {
		this.#snapshot = Object.freeze({
			revision: this.#revision,
			thoughtRevision: this.#thoughtRevision,
			finalizedBlockKeys: this.#finalizedBlockKeys,
			startedToolInputKeys: this.#startedToolInputKeys,
		});
	}
}

export class SessionProjectorCache {
	readonly #entries = new Map<SessionId, SessionProjectorPair>();

	constructor(readonly maxEntries = SESSION_PROJECTOR_CACHE_MAX_ENTRIES) {
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new RangeError('Session projector cache size must be a positive integer');
		}
	}

	get size(): number {
		return this.#entries.size;
	}

	acquire(sessionId: SessionId): SessionProjectorPair {
		const existing = this.#entries.get(sessionId);
		if (existing) {
			this.#entries.delete(sessionId);
			this.#entries.set(sessionId, existing);
			return existing;
		}

		const pair: SessionProjectorPair = {
			render: new IncrementalRenderProjector(),
			timeline: new IncrementalRunTimelineProjector(),
			streaming: new IncrementalSessionStreamingProjector(),
		};
		this.#entries.set(sessionId, pair);
		this.#evictOverflow();
		return pair;
	}

	invalidate(sessionId: SessionId): boolean {
		return this.#entries.delete(sessionId);
	}

	clear(): void {
		this.#entries.clear();
	}

	#evictOverflow(): void {
		while (this.#entries.size > this.maxEntries) {
			const leastRecentlyUsedSessionId = this.#entries.keys().next().value;
			if (leastRecentlyUsedSessionId === undefined) return;
			this.#entries.delete(leastRecentlyUsedSessionId);
		}
	}
}
