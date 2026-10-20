import type { SessionId } from '$lib/chat/domain/session';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';

export { watchShownChatCommand };

function watchShownChatCommand(workstreamId: string, chatId: SessionId | null): void {
	agentLifecycleMonitor.setShown(workstreamId, chatId);
	if (chatId) agentActivity.clearChat(chatId);
}
