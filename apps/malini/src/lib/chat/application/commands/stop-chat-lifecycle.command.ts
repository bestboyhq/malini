import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';

export { stopChatLifecycleCommand };

function stopChatLifecycleCommand(): void {
	agentLifecycleMonitor.stop();
}
