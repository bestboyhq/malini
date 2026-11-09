import type { ClaudeCodeInstall } from '$shared/providers/domain/claude-code-status';

class ClaudeCodeInstallStore {
	state: ClaudeCodeInstall = $state.raw({ kind: 'idle' });
}

export const claudeCodeInstallStore = new ClaudeCodeInstallStore();
