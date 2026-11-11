import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';
import { claudeCodeUpdateStore } from '$shared/providers/infrastructure/stores/claude-code-update.store.svelte';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { updateClaudeCodeCommand };

function updateClaudeCodeCommand(now = false): void {
	if (now && claudeCodeUpdateStore.state.retrying) return;
	if (now) claudeCodeUpdateStore.state = { ...claudeCodeUpdateStore.state, retrying: true };
	void (async () => {
		try {
			const { updated, failed } = await claudeSetupService.update(now);
			claudeCodeUpdateStore.state = { ...claudeCodeUpdateStore.state, failed };
			if (updated) await providerCapabilitiesStore.reload();
		} finally {
			if (now) claudeCodeUpdateStore.state = { ...claudeCodeUpdateStore.state, retrying: false };
		}
	})();
}
