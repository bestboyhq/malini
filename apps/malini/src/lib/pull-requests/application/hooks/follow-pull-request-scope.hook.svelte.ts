import { untrack } from 'svelte';
import { keepWorkstreamCurrentCommand } from '$lib/pull-requests/application/commands/keep-workstream-current.command';
import { loadRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/load-repository-surface.command';
import { releasePullRequestScopeCommand } from '$lib/pull-requests/application/commands/release-pull-request-scope.command';
import {
	trackPullRequestScopeCommand,
	type PullRequestScope,
} from '$lib/pull-requests/application/commands/track-pull-request-scope.command';

export function followPullRequestScopeHook(readScope: () => PullRequestScope): () => void {
	let loadedActivation = '';
	let openedWorkstreamId = '';
	const stop = $effect.root(() => {
		$effect(() => {
			const scope = readScope();
			untrack(() => trackPullRequestScopeCommand(scope));
			if (scope.workstreamId && scope.workstreamId !== openedWorkstreamId) {
				openedWorkstreamId = scope.workstreamId;
				untrack(() => keepWorkstreamCurrentCommand(scope.workstreamId));
			}
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
