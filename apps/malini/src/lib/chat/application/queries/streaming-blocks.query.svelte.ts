import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import type { StreamingBlock } from '$lib/chat/domain/streaming-block';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export { streamingBlocksQuery };

class StreamingBlocksQuery {
	public readonly data: (sessionId: SessionId, runId: RunId) => readonly StreamingBlock[] =
		$derived((sessionId: SessionId, runId: RunId) => streamingStore.blocksForRun(sessionId, runId));
}

const streamingBlocksQuery = new StreamingBlocksQuery();
