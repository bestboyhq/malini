import type { GithubRepositoryListing } from '$shared/repositories/domain/repository';
import { repositoryConnectFailure } from '$shared/repositories/domain/repository-connection';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GithubRepositoriesAggregate {
	listing: GithubRepositoryListing = $state.raw({ kind: 'loading' });

	#revision = 0;

	async load(): Promise<void> {
		const revision = ++this.#revision;
		if (this.listing.kind === 'failed') this.listing = { kind: 'loading' };
		try {
			const repositories = await githubService.listGithubRepositories();
			if (revision === this.#revision) this.listing = { kind: 'loaded', repositories };
		} catch (caught) {
			if (revision !== this.#revision) return;
			this.listing = {
				kind: 'failed',
				failure: repositoryConnectFailure(caught, 'Could not list your GitHub repositories'),
			};
		}
	}
}

export const githubRepositoriesAggregate = new GithubRepositoriesAggregate();
