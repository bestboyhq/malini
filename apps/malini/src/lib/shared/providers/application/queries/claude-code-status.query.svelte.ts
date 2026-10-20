import {
	claudeCodeStatus,
	type ClaudeCodeStatus,
} from '$shared/providers/domain/claude-code-status';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { claudeCodeStatusQuery };

class ClaudeCodeStatusQuery {
	public readonly data: ClaudeCodeStatus = $derived(
		claudeCodeStatus(providerCapabilitiesStore.capability, providerCapabilitiesStore.error),
	);
}

const claudeCodeStatusQuery = new ClaudeCodeStatusQuery();
