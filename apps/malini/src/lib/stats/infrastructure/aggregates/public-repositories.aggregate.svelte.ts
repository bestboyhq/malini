import type { PublicRepository } from '$contract/stats';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

class PublicRepositoriesAggregate {
	repositories = $state.raw<readonly PublicRepository[] | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const repositories = await profileService.publicRepositories();
		if (generation !== this.#generation) return;
		this.repositories = repositories;
	}
}

export const publicRepositoriesAggregate = new PublicRepositoriesAggregate();
