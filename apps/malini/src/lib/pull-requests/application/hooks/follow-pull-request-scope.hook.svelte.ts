import { untrack } from 'svelte';
import { loadRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/load-repository-surface.command';
import { releasePullRequestScopeCommand } from '$lib/pull-requests/application/commands/release-pull-request-scope.command';
import {
	trackPullRequestScopeCommand,
	type PullRequestScope,
} from '$lib/pull-requests/application/commands/track-pull-request-scope.command';

export function followPullRequestScopeHook(readScope: () => PullRequestScope): () => void {
	let loadedActivation = '';
	const stop = $effect.root(() => {
		$effect(() => {
			const scope = readScope();
			untrack(() => trackPullRequestScopeCommand(scope));
			const activation =
				scope.extensionReady && scope.workstreamId
					? `${scope.workstreamId}@${scope.extensionGeneration}`
					: '';
			if (activation === loadedActivation) return;
			loadedActivation = activation;
			if (!activation) return;
			untrack(() => loadRepositorySurfaceCommand(scope.workstreamId));
		});
	});
	return () => {
		stop();
		releasePullRequestScopeCommand();
	};
}
