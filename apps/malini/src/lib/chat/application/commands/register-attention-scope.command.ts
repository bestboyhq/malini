import type { AgentWorkstreamContext } from '$lib/chat/domain/agent-attention';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';

export { registerAttentionScopeCommand };

function registerAttentionScopeCommand(contexts: readonly AgentWorkstreamContext[]): void {
	agentActivity.registerWorkstreamScope(contexts);
	agentLifecycleMonitor.flushKnownSessions();
}
