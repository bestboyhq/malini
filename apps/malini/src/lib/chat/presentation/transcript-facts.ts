import type { EventEnvelope } from '$lib/chat/domain/events';
import {
	EMPTY_ENVELOPE_SOURCE,
	envelopeSource,
	envelopeSourceChange,
	type EnvelopeSource,
} from './envelope-source';
import {
	EMPTY_RUNTIME_METADATA,
	foldRuntimeMetadata,
	type RunTokenUsage,
	type SessionRuntimeMetadata,
} from './session-runtime-metadata';

export type RedoCheckpointTarget = Readonly<{ restoreSeq: number; toSeq: number }>;

export type TranscriptFacts = Readonly<{
	lastRunId: string | null;
	lastRunUsage: RunTokenUsage | null;
	runtime: SessionRuntimeMetadata;
	branchedFromSessionId: string | null;
	redoCheckpointTarget: RedoCheckpointTarget | null;
}>;

export const EMPTY_TRANSCRIPT_FACTS: TranscriptFacts = Object.freeze({
	lastRunId: null,
	lastRunUsage: null,
	runtime: Object.freeze({ context: null, mcpServers: null }),
	branchedFromSessionId: null,
	redoCheckpointTarget: null,
});

export class TranscriptFactsProjector {
	#source: EnvelopeSource = EMPTY_ENVELOPE_SOURCE;
	#lastRunId: string | null = null;
	#lastRunUsage: RunTokenUsage | null = null;
	#runtime: SessionRuntimeMetadata = EMPTY_RUNTIME_METADATA;
	#branchedFromSessionId: string | null = null;
	#liveTalkSeq = 0;
	#redoneSeqs = new Set<number>();
	#salvageableRestores: RedoCheckpointTarget[] = [];
	#snapshot: TranscriptFacts = EMPTY_TRANSCRIPT_FACTS;

	project(envelopes: readonly EventEnvelope[]): TranscriptFacts {
		if (envelopes === this.#source.envelopes && envelopes.length === this.#source.length) {
			return this.#snapshot;
		}
		const change = envelopeSourceChange(this.#source, envelopes);
		this.#source = envelopeSource(envelopes);
		if (change.kind === 'unchanged') return this.#snapshot;
		if (change.kind === 'append') {
			for (let index = change.from; index < envelopes.length; index += 1) {
				const envelope = envelopes[index];
				if (envelope) this.#apply(envelope);
			}
		} else {
			this.#reset();
			for (const envelope of envelopes) this.#apply(envelope);
		}
		this.#publish();
		return this.#snapshot;
	}

	#reset(): void {
		this.#lastRunId = null;
		this.#lastRunUsage = null;
		this.#runtime = EMPTY_RUNTIME_METADATA;
		this.#branchedFromSessionId = null;
		this.#liveTalkSeq = 0;
		this.#redoneSeqs.clear();
		this.#salvageableRestores = [];
	}

	#apply(envelope: EventEnvelope): void {
		if (envelope.runId) this.#lastRunId = envelope.runId;
		this.#runtime = foldRuntimeMetadata(this.#runtime, envelope);
		const event = envelope.event;
		switch (event.type) {
			case 'usage.updated':
				if (event.interim === true) return;
				this.#lastRunUsage = {
					inputTokens: event.inputTokens ?? 0,
					outputTokens: event.outputTokens ?? 0,
					costUsd: event.costUsd ?? null,
				};
				return;
			case 'session.branched':
				if (this.#branchedFromSessionId === null && event.childSessionId === envelope.sessionId) {
					this.#branchedFromSessionId = event.parentSessionId;
				}
				return;
			case 'user.message':
			case 'run.started':
				if (envelope.seq > this.#liveTalkSeq) this.#liveTalkSeq = envelope.seq;
				return;
			case 'turn.restored':
				this.#redoneSeqs.add(event.restoreSeq);
				return;
			case 'checkpoint.restored':
				if (event.salvageCommit) {
					this.#salvageableRestores.push({ restoreSeq: envelope.seq, toSeq: event.toSeq });
				}
				return;
			default:
				return;
		}
	}

	#redoCheckpointTarget(): RedoCheckpointTarget | null {
		for (let index = this.#salvageableRestores.length - 1; index >= 0; index -= 1) {
			const restore = this.#salvageableRestores[index];
			if (!restore || restore.restoreSeq < this.#liveTalkSeq) return null;
			if (!this.#redoneSeqs.has(restore.restoreSeq)) return restore;
		}
		return null;
	}

	#publish(): void {
		const previous = this.#snapshot;
		const redoCheckpointTarget = this.#redoCheckpointTarget();
		const lastRunUsage = sameUsage(previous.lastRunUsage, this.#lastRunUsage)
			? previous.lastRunUsage
			: this.#lastRunUsage;
		this.#lastRunUsage = lastRunUsage;
		if (
			previous.lastRunId === this.#lastRunId &&
			previous.lastRunUsage === lastRunUsage &&
			previous.runtime === this.#runtime &&
			previous.branchedFromSessionId === this.#branchedFromSessionId &&
			previous.redoCheckpointTarget === redoCheckpointTarget
		) {
			return;
		}
		this.#snapshot = {
			lastRunId: this.#lastRunId,
			lastRunUsage,
			runtime: this.#runtime,
			branchedFromSessionId: this.#branchedFromSessionId,
			redoCheckpointTarget,
		};
	}
}

function sameUsage(left: RunTokenUsage | null, right: RunTokenUsage | null): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.inputTokens === right.inputTokens &&
		left.outputTokens === right.outputTokens &&
		left.costUsd === right.costUsd
	);
}
