import type {
	GithubRepository,
	GithubRepositoryListing,
} from '$shared/repositories/domain/repository';
import { repositoryConnectFailure } from '$shared/repositories/domain/repository-connection';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GithubRepositoriesAggregate {
	listing: GithubRepositoryListing = $state.raw({ kind: 'loading' });
	owners: readonly string[] = $state.raw([]);

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

	async loadOwners(): Promise<void> {
		try {
			this.owners = await githubService.listGithubOwners();
		} catch {
			this.owners = [];
		}
	}

	add(repository: GithubRepository): void {
		const known = this.listing.kind === 'loaded' ? this.listing.repositories : [];
		this.listing = {
			kind: 'loaded',
			repositories: [repository, ...known.filter((repo) => repo.fullName !== repository.fullName)],
		};
	}
}

export const githubRepositoriesAggregate = new GithubRepositoriesAggregate();
