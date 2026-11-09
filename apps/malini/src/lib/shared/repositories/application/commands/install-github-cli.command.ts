import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { githubCliInstallStore } from '$shared/repositories/infrastructure/stores/github-cli-install.store.svelte';

export { installGithubCliCommand };

function installGithubCliCommand(): void {
	if (githubCliInstallStore.state.kind === 'installing') return;
	githubCliInstallStore.state = { kind: 'installing' };
	void (async () => {
		try {
			await githubService.installCli();
			await githubAuthAggregate.load();
			githubCliInstallStore.state = { kind: 'idle' };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			githubCliInstallStore.state = { kind: 'failed', message };
		}
	})();
}
