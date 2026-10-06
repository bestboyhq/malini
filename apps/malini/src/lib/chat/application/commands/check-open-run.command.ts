import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { openRunsStore } from '$lib/chat/infrastructure/stores/open-runs.store.svelte';

export { checkOpenRunCommand };

function checkOpenRunCommand(workstreamId: string): void {
	const revision = openRunsStore.begin(workstreamId);
	void (async () => {
		try {
			const open = await agentSessions.hasOpenRun(workstreamId);
			openRunsStore.settle(workstreamId, revision, open);
		} catch {
			openRunsStore.settle(workstreamId, revision, false);
		}
	})();
}
