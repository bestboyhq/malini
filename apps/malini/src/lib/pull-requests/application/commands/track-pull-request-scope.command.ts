import type { ExtensionWorkstream } from '@malini/extension-api';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { trackPullRequestScopeCommand };

export type PullRequestScope = Readonly<{
	workstreamId: string;
	agentSessionId: string | null;
	extensionWorkstream: ExtensionWorkstream | null;
	extensionGeneration: number;
	extensionReady: boolean;
	repositoryScopeReady: boolean;
	remotePullRequestsSupported: boolean;
	repositoryExtensionRegistered: boolean;
}>;

function trackPullRequestScopeCommand(scope: PullRequestScope): void {
	if (
		pullRequestScopeStore.workstreamId !== scope.workstreamId ||
		pullRequestScopeStore.extensionGeneration !== scope.extensionGeneration ||
		pullRequestScopeStore.extensionWorkstream !== scope.extensionWorkstream
	) {
		pullRequestActionStore.reset();
	}

	pullRequestScopeStore.workstreamId = scope.workstreamId;
	pullRequestScopeStore.agentSessionId = scope.agentSessionId;
	pullRequestScopeStore.extensionWorkstream = scope.extensionWorkstream;
	pullRequestScopeStore.extensionGeneration = scope.extensionGeneration;
	pullRequestScopeStore.extensionReady = scope.extensionReady;
	pullRequestScopeStore.repositoryScopeReady = scope.repositoryScopeReady;
	pullRequestScopeStore.remotePullRequestsSupported = scope.remotePullRequestsSupported;
	pullRequestScopeStore.repositoryExtensionRegistered = scope.repositoryExtensionRegistered;
}
