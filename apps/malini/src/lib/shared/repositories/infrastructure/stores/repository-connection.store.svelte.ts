import type {
	RepositoryConnectFailure,
	RepositoryConnectingKind,
	RepositoryConnection,
} from '$shared/repositories/domain/repository-connection';

class RepositoryConnectionStore {
	connecting: RepositoryConnection | null = $state.raw(null);
	error: RepositoryConnectFailure | null = $state.raw(null);
	preparing: ReadonlySet<string> = $state.raw(new Set());
	preparationFailures: ReadonlyMap<string, RepositoryConnectFailure> = $state.raw(new Map());
	requested: RepositoryConnectingKind | null = $state.raw(null);

	startPreparing(repositoryId: string): boolean {
		if (this.preparing.has(repositoryId)) return false;
		this.preparing = new Set([...this.preparing, repositoryId]);
		this.preparationFailures = new Map(
			[...this.preparationFailures].filter(([id]) => id !== repositoryId),
		);
		return true;
	}

	finishPreparing(repositoryId: string, failure: RepositoryConnectFailure | null): void {
		this.preparing = new Set([...this.preparing].filter((id) => id !== repositoryId));
		if (!failure) return;
		this.preparationFailures = new Map([...this.preparationFailures, [repositoryId, failure]]);
	}
}

export const repositoryConnectionStore = new RepositoryConnectionStore();
