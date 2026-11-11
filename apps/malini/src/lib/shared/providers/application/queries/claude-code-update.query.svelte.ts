import type { ClaudeCodeUpdate } from '$shared/providers/domain/claude-code-status';
import { claudeCodeUpdateStore } from '$shared/providers/infrastructure/stores/claude-code-update.store.svelte';

export { claudeCodeUpdateQuery };

class ClaudeCodeUpdateQuery {
	public readonly data: ClaudeCodeUpdate = $derived(claudeCodeUpdateStore.state);
}

const claudeCodeUpdateQuery = new ClaudeCodeUpdateQuery();
