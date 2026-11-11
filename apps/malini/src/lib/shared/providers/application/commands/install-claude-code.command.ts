import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';
import { claudeCodeInstallStore } from '$shared/providers/infrastructure/stores/claude-code-install.store.svelte';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { installClaudeCodeCommand };

function installClaudeCodeCommand(): void {
	if (claudeCodeInstallStore.state.kind === 'installing') return;
	claudeCodeInstallStore.state = { kind: 'installing', progress: null };
	const stopProgress = claudeSetupService.onInstallProgress((progress) => {
		claudeCodeInstallStore.state = { kind: 'installing', progress };
	});
	void (async () => {
		try {
			await claudeSetupService.install();
			await providerCapabilitiesStore.reload();
			claudeCodeInstallStore.state = { kind: 'idle' };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			claudeCodeInstallStore.state = { kind: 'failed', message };
		} finally {
			stopProgress();
		}
	})();
}
