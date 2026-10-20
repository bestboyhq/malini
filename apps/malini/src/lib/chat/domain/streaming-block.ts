import type { EventEnvelope } from './events';
import type { RunId } from './run';
import type { SessionId } from './session';

export type StreamingBlockKind = 'assistant' | 'thinking';

export type StreamingBlock = {
	readonly contentId: string;
	readonly runId: RunId;
	readonly kind: StreamingBlockKind;
	readonly text: string;
	readonly latestChunkLength: number;
	readonly revision: number;
	readonly startedAt: number;
};

export type FinalizedBlock = {
	readonly contentId: string;
	readonly runId: RunId;
	readonly kind: StreamingBlockKind;
	readonly text: string;
	readonly durationMs: number;
};

export type LiveContextUsage = {
	readonly runId: RunId;
	readonly contextTokens: number;
	readonly contextWindowTokens: number | null;
};

export type StreamingIngestionStats = {
	trackedEnvelopes: number;
	reactiveCommits: number;
	toolInputCharsDropped: number;
};

export type StreamingBlockRegistry = {
	finalizeBlock(
		sessionId: SessionId,
		runId: RunId,
		contentId: string,
	): { text: string; durationMs: number } | null;
	finalizeToolInput(sessionId: SessionId, runId: RunId, toolCallId: string): string | null;
	clearRun(sessionId: SessionId, runId?: RunId): void;
};

export type LiveToolInput = {
	readonly toolCallId: string;
	readonly name: string;
	readonly json: string;
};

export type FinalizedStreamingThought = Readonly<{
	sessionId: SessionId;
	runId: string;
	contentId: string;
	seq: number;
	text: string;
	durationSeconds: number | null;
}>;

export type FinalizedThoughtRecorder = Readonly<{
	recordFinalizedThought(
		thought: FinalizedStreamingThought,
		sourceEnvelope: EventEnvelope,
	): boolean;
}>;
