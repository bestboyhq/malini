class RepositoriesScopeRetryStore {
	retrying: boolean = $state(false);
}

export const repositoriesScopeRetryStore = new RepositoriesScopeRetryStore();
