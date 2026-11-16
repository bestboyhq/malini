import type { EventEnvelope } from './events';
import type { FinalizedThoughtRecorder, StreamingBlockRegistry } from './streaming-block';

export function processStreamingEnvelopes(
	batch: readonly EventEnvelope[],
	streamingProjector: FinalizedThoughtRecorder,
	registry: StreamingBlockRegistry,
): boolean {
	let thoughtsChanged = false;
	for (const envelope of batch) {
		const event = envelope.event;
		if (event.type === 'assistant.message') {
			if (event.contentId) {
				registry.finalizeBlock(envelope.sessionId, envelope.runId, event.contentId);
			}
			continue;
		}
		if (event.type === 'thinking.message') {
			const finalized = registry.finalizeBlock(envelope.sessionId, envelope.runId, event.contentId);
			const text = finalized?.text || event.text;
			if (!text.trim()) continue;
			thoughtsChanged =
				streamingProjector.recordFinalizedThought(
					{
						sessionId: envelope.sessionId,
						runId: envelope.runId,
						contentId: event.contentId,
						seq: envelope.seq,
						text,
						durationSeconds: thoughtSeconds(event.durationMs ?? finalized?.durationMs),
					},
					envelope,
				) || thoughtsChanged;
			continue;
		}
		if (
			(event.type === 'tool.started' ||
				event.type === 'tool.completed' ||
				event.type === 'tool.failed') &&
			event.toolCallId
		) {
			registry.finalizeToolInput(envelope.sessionId, envelope.runId, event.toolCallId);
			continue;
		}
		if (event.type === 'run.completed' || event.type === 'run.failed') {
			registry.clearRun(envelope.sessionId, envelope.runId);
		}
	}
	return thoughtsChanged;
}

export function thoughtSeconds(durationMs: number | undefined): number | null {
	return durationMs === undefined ? null : Math.max(1, Math.round(durationMs / 1000));
}
