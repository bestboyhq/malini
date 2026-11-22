import { repositoryAvatarsAggregate } from '$shared/repositories/infrastructure/aggregates/repository-avatars.aggregate.svelte';

export { githubUserAvatarQuery };

class GithubUserAvatarQuery {
	public readonly data: (login: string) => string | null = $derived((login: string) =>
		repositoryAvatarsAggregate.urlFor(login),
	);
}

const githubUserAvatarQuery = new GithubUserAvatarQuery();
