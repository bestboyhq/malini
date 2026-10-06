import {
	liveMergeConfirmation,
	type MergeConfirmation,
} from '$lib/pull-requests/domain/merge-confirmation';
import { pullRequestAvailabilityOf } from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBarPresentation } from '$lib/pull-requests/domain/pull-request-top-bar';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { mergeConfirmationQuery };

class MergeConfirmationQuery {
	public readonly data: MergeConfirmation | null = $derived.by(() => {
		const surface = repositorySurfaceAggregate.presentedSurfaceFor(
			pullRequestScopeStore.workstreamId,
		);
		const presentation = pullRequestTopBarPresentation(
			surface,
			pullRequestAvailabilityOf(pullRequestScopeStore),
		);
		if (presentation?.kind !== 'merge') return null;
		return liveMergeConfirmation(pullRequestActionStore.mergeRequest, surface?.pullRequest);
	});
}

const mergeConfirmationQuery = new MergeConfirmationQuery();
