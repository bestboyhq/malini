import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';

export { watchActiveWorkstreamCommand };

function watchActiveWorkstreamCommand(workstreamId: string): void {
	agentLifecycleMonitor.setActiveWorkstream(workstreamId);
}
