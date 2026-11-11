import type { ClaudeCodeInstall } from '$shared/providers/domain/claude-code-status';
import { claudeCodeInstallStore } from '$shared/providers/infrastructure/stores/claude-code-install.store.svelte';

export { claudeCodeInstallQuery };

class ClaudeCodeInstallQuery {
	public readonly data: ClaudeCodeInstall = $derived(claudeCodeInstallStore.state);
}

const claudeCodeInstallQuery = new ClaudeCodeInstallQuery();
