import type {
	RepositoryConnectFailure,
	RepositoryConnection,
} from '$shared/repositories/domain/repository-connection';

class RepositoryConnectionStore {
	connecting: RepositoryConnection | null = $state.raw(null);
	error: RepositoryConnectFailure | null = $state.raw(null);
	folderRequested = $state(false);
}

export const repositoryConnectionStore = new RepositoryConnectionStore();
