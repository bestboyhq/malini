import { githubOwnerFromFullName } from '$shared/repositories/domain/repository-context';
import { repositoryAvatarsAggregate } from '$shared/repositories/infrastructure/aggregates/repository-avatars.aggregate.svelte';

export { repositoryAvatarQuery };

class RepositoryAvatarQuery {
	public readonly data: (fullName: string) => string | null = $derived((fullName: string) => {
		const owner = githubOwnerFromFullName(fullName);
		return owner ? repositoryAvatarsAggregate.urlFor(owner) : null;
	});
}

const repositoryAvatarQuery = new RepositoryAvatarQuery();
