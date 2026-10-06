import { repositoriesScopeRetryStore } from '$shared/repositories/infrastructure/stores/repositories-scope-retry.store.svelte';

export { repositoriesScopeRetryingQuery };

class RepositoriesScopeRetryingQuery {
	public readonly data: boolean = $derived(repositoriesScopeRetryStore.retrying);
}

const repositoriesScopeRetryingQuery = new RepositoriesScopeRetryingQuery();
