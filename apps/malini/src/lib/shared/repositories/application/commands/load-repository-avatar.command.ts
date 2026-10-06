import { githubOwnerFromFullName } from '$shared/repositories/domain/repository-context';
import { repositoryAvatarsAggregate } from '$shared/repositories/infrastructure/aggregates/repository-avatars.aggregate.svelte';

export { loadRepositoryAvatarCommand };

function loadRepositoryAvatarCommand(fullName: string): void {
	const owner = githubOwnerFromFullName(fullName);
	if (!owner) return;
	void repositoryAvatarsAggregate.load(owner);
}
