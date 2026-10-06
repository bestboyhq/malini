import type { ClaudeSetupStep } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ClaudeSetupService {
	run(step: ClaudeSetupStep): Promise<void> {
		return invoke('providers.run-claude-setup', { step });
	}
}

export const claudeSetupService = new ClaudeSetupService();
