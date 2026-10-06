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
	extensionFailed: boolean;
	repositoryScopeReady: boolean;
	remotePullRequestsSupported: boolean;
	repositoryExtensionRegistered: boolean;
	agentRunning: boolean;
}>;

function trackPullRequestScopeCommand(scope: PullRequestScope): void {
	const movedWorkstream = pullRequestScopeStore.workstreamId !== scope.workstreamId;
	const reactivated =
		pullRequestScopeStore.extensionGeneration !== scope.extensionGeneration ||
		pullRequestScopeStore.extensionWorkstream !== scope.extensionWorkstream;
	if (movedWorkstream) pullRequestActionStore.reset();
	else if (reactivated) pullRequestActionStore.invalidate();
	pullRequestActionStore.followActivation({
		ready: scope.extensionReady,
		failed: scope.extensionFailed,
		reactivated,
	});

	pullRequestScopeStore.workstreamId = scope.workstreamId;
	pullRequestScopeStore.agentSessionId = scope.agentSessionId;
	pullRequestScopeStore.extensionWorkstream = scope.extensionWorkstream;
	pullRequestScopeStore.extensionGeneration = scope.extensionGeneration;
	pullRequestScopeStore.extensionReady = scope.extensionReady;
	pullRequestScopeStore.extensionFailed = scope.extensionFailed;
	pullRequestScopeStore.repositoryScopeReady = scope.repositoryScopeReady;
	pullRequestScopeStore.remotePullRequestsSupported = scope.remotePullRequestsSupported;
	pullRequestScopeStore.repositoryExtensionRegistered = scope.repositoryExtensionRegistered;
	pullRequestScopeStore.agentRunning = scope.agentRunning;
}
