import type { ClaudeCodeUpdate } from '$shared/providers/domain/claude-code-status';

class ClaudeCodeUpdateStore {
	state: ClaudeCodeUpdate = $state.raw({ failed: null, retrying: false });
}

export const claudeCodeUpdateStore = new ClaudeCodeUpdateStore();
