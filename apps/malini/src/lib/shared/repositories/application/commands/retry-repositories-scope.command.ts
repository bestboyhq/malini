import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { repositoriesScopeRetryStore } from '$shared/repositories/infrastructure/stores/repositories-scope-retry.store.svelte';

export { retryRepositoriesScopeCommand };

function retryRepositoriesScopeCommand(): void {
	if (repositoriesScopeRetryStore.retrying) return;
	repositoriesScopeRetryStore.retrying = true;
	void (async () => {
		try {
			await Promise.allSettled([workstreamsAggregate.refresh(), repositoriesAggregate.refresh()]);
		} finally {
			repositoriesScopeRetryStore.retrying = false;
		}
	})();
}
