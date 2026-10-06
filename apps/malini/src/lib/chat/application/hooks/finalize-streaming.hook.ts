import type { EventEnvelope } from '$lib/chat/domain/events';
import type { FinalizedThoughtRecorder } from '$lib/chat/domain/streaming-block';
import { processStreamingEnvelopes } from '$lib/chat/domain/streaming-finalization';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export { finalizeStreamingHook };

function finalizeStreamingHook(): (
	batch: readonly EventEnvelope[],
	recorder: FinalizedThoughtRecorder,
) => boolean {
	return (batch, recorder) => processStreamingEnvelopes(batch, recorder, streamingStore);
}
