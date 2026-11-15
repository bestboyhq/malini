import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';
import { page } from '$shared/router/state';

export { refreshActivePullRequestCommand };

function refreshActivePullRequestCommand(workstreamId: string): void {
	if (workstreamId !== (page.params.workstreamId ?? '')) return;
	void activeWorkstreamFreshnessStore.refreshNow({ pullRequest: true });
}
