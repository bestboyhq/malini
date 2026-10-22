import type { RepositoryConnectingKind } from '$shared/repositories/domain/repository-connection';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';

export { requestRepositoryConnectionCommand };

function requestRepositoryConnectionCommand(kind: RepositoryConnectingKind): void {
	repositoryConnectionStore.requested = kind;
	void goto(REPOSITORIES_HREF);
}
