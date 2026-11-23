import { gitSetupService } from '$shared/repositories/infrastructure/services/git-setup.service';
import { gitSetupStore } from '$shared/repositories/infrastructure/stores/git-setup.store.svelte';

export { loadGitSetupCommand };

function loadGitSetupCommand(): void {
	void (async () => {
		try {
			gitSetupStore.state = { kind: await gitSetupService.status() };
		} catch {
			gitSetupStore.state = { kind: 'ready' };
		}
	})();
}
