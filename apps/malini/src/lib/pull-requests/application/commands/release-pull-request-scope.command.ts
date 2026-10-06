import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { releasePullRequestScopeCommand };

function releasePullRequestScopeCommand(): void {
	pullRequestActionStore.reset();
	pullRequestScopeStore.workstreamId = '';
	pullRequestScopeStore.agentSessionId = null;
	pullRequestScopeStore.extensionWorkstream = null;
	pullRequestScopeStore.extensionReady = false;
	pullRequestScopeStore.extensionFailed = false;
	pullRequestScopeStore.repositoryScopeReady = false;
	pullRequestScopeStore.remotePullRequestsSupported = false;
	pullRequestScopeStore.repositoryExtensionRegistered = false;
}
