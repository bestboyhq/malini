import { fullToolOutputKey } from '$lib/chat/domain/full-tool-output';
import type { SessionId } from '$lib/chat/domain/session';
import { toolOutputsAggregate } from '$lib/chat/infrastructure/aggregates/tool-outputs.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';

export { loadFullToolOutputCommand };

function loadFullToolOutputCommand(sessionId: SessionId, toolCallId: string): void {
	const key = fullToolOutputKey(sessionId, toolCallId);
	const current = toolOutputsAggregate.outputs[key];
	if (current && current.status !== 'failed') return;
	toolOutputsAggregate.set(key, { status: 'loading' });
	void (async () => {
		try {
			const output = await agentSessions.toolOutput(sessionId, toolCallId);
			toolOutputsAggregate.set(key, { status: 'ready', output });
		} catch (error) {
			toolOutputsAggregate.set(key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
