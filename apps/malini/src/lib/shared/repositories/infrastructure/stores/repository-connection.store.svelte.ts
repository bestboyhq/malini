import type {
	RepositoryConnectFailure,
	RepositoryConnection,
} from '$shared/repositories/domain/repository-connection';

class RepositoryConnectionStore {
	connecting: RepositoryConnection | null = $state.raw(null);
	error: RepositoryConnectFailure | null = $state.raw(null);

	reset(): void {
		this.connecting = null;
		this.error = null;
	}
}

export const repositoryConnectionStore = new RepositoryConnectionStore();
