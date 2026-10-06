import { agentRecovery } from '$lib/chat/infrastructure/services/agent-recovery.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { startFreshChatCommand };

function startFreshChatCommand(): void {
	const workstreamId = chatRoute.workstreamId;
	void (async () => {
		if (!(await agentRecovery.startFreshChat()) || !workstreamId) return;
		toast.info('Fresh chat ready', aboutWorkstream(workstreamId));
	})();
}
