import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';

export { refreshRepositoriesCommand };

function refreshRepositoriesCommand(): void {
	void repositoriesAggregate.refresh();
}
