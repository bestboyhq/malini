import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';

export { installedCountQuery };

class InstalledCountQuery {
	public readonly data: number = $derived(installedExtensionsAggregate.installed?.length ?? 0);
}

const installedCountQuery = new InstalledCountQuery();
