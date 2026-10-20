import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';

export { startChatLifecycleCommand };

function startChatLifecycleCommand(): void {
	agentLifecycleMonitor.start();
}
