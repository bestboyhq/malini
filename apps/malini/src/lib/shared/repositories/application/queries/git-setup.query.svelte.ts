import type { GitSetup } from '$shared/repositories/domain/git-setup';
import { gitSetupStore } from '$shared/repositories/infrastructure/stores/git-setup.store.svelte';

export { gitSetupQuery };

class GitSetupQuery {
	public readonly data: GitSetup = $derived(gitSetupStore.state);
}

const gitSetupQuery = new GitSetupQuery();
