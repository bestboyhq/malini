import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { loadRepositoriesScopeCommand };

const SCOPE_LOAD_ATTEMPTS = 3;

async function loadRepositoriesScopeCommand(): Promise<void> {
	for (let attempt = 0; attempt < SCOPE_LOAD_ATTEMPTS && !scopeLoaded(); attempt += 1) {
		await Promise.all([
			workstreamsAggregate.loaded ? undefined : workstreamsAggregate.refresh(),
			repositoriesAggregate.loaded ? undefined : repositoriesAggregate.refresh(),
		]);
	}
}

function scopeLoaded(): boolean {
	return workstreamsAggregate.loaded && repositoriesAggregate.loaded;
}
