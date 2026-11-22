import { repositoryAvatarsAggregate } from '$shared/repositories/infrastructure/aggregates/repository-avatars.aggregate.svelte';

export { loadGithubUserAvatarCommand };

function loadGithubUserAvatarCommand(login: string): void {
	void repositoryAvatarsAggregate.load(login);
}
