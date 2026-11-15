import { gitSetupService } from '$shared/repositories/infrastructure/services/git-setup.service';
import { gitSetupStore } from '$shared/repositories/infrastructure/stores/git-setup.store.svelte';

export { installGitCommand };

function installGitCommand(): void {
	if (gitSetupStore.state.kind === 'installing') return;
	gitSetupStore.state = { kind: 'installing', progress: null };
	const stopProgress = gitSetupService.onInstallProgress((progress) => {
		gitSetupStore.state = { kind: 'installing', progress };
	});
	void (async () => {
		try {
			await gitSetupService.install();
			gitSetupStore.state = { kind: 'ready' };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			gitSetupStore.state = { kind: 'failed', message };
		} finally {
			stopProgress();
		}
	})();
}
