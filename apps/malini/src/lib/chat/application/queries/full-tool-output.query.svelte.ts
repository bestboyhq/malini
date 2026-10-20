import { fullToolOutputKey, type FullToolOutput } from '$lib/chat/domain/full-tool-output';
import type { SessionId } from '$lib/chat/domain/session';
import { toolOutputsAggregate } from '$lib/chat/infrastructure/aggregates/tool-outputs.aggregate.svelte';

export { fullToolOutputQuery };

class FullToolOutputQuery {
	public readonly data: (sessionId: SessionId, toolCallId: string) => FullToolOutput | null =
		$derived(
			(sessionId: SessionId, toolCallId: string) =>
				toolOutputsAggregate.outputs[fullToolOutputKey(sessionId, toolCallId)] ?? null,
		);
}

const fullToolOutputQuery = new FullToolOutputQuery();
