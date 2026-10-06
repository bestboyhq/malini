import type { ExtensionWorkstream } from '@malini/extension-api';
import {
	pullRequestActionScopeIsCurrent,
	type PullRequestActionScope,
	type PullRequestActionScopeSnapshot,
} from '$lib/pull-requests/domain/pull-request-action-scope';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';

class PullRequestScopeStore {
	workstreamId = $state('');
	agentSessionId = $state<string | null>(null);
	extensionWorkstream = $state.raw<ExtensionWorkstream | null>(null);
	extensionGeneration = $state(0);
	extensionReady = $state(false);
	extensionFailed = $state(false);
	repositoryScopeReady = $state(false);
	remotePullRequestsSupported = $state(false);
	repositoryExtensionRegistered = $state(false);
	agentRunning = $state(false);

	snapshot(): PullRequestActionScopeSnapshot<ExtensionWorkstream> {
		return {
			workstreamId: this.workstreamId,
			sessionId: this.agentSessionId,
			extensionWorkstream: this.extensionWorkstream,
			extensionGeneration: this.extensionGeneration,
			actionRevision: pullRequestActionStore.revision,
			ready: this.extensionReady,
		};
	}

	isCurrent(scope: PullRequestActionScope<ExtensionWorkstream>): boolean {
		return pullRequestActionScopeIsCurrent(scope, this.snapshot());
	}

	claim(busyLabel: string | null = null): PullRequestActionScope<ExtensionWorkstream> | null {
		const extensionWorkstream = this.extensionWorkstream;
		if (!this.extensionReady || extensionWorkstream === null) return null;
		if (extensionWorkstream.id !== this.workstreamId) return null;
		return {
			workstreamId: this.workstreamId,
			sessionId: this.agentSessionId,
			extensionWorkstream,
			extensionGeneration: this.extensionGeneration,
			actionRevision: pullRequestActionStore.claim(busyLabel),
		};
	}
}

export const pullRequestScopeStore = new PullRequestScopeStore();
