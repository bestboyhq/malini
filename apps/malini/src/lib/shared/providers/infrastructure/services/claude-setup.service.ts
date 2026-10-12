import type { ClaudeSignInOutcome } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ClaudeSetupService {
	install(): Promise<void> {
		return invoke('providers.install-claude-code', undefined);
	}

	signIn(email: string | null): Promise<ClaudeSignInOutcome> {
		return invoke('providers.sign-in-to-claude', email ? { email } : {});
	}

	cancelSignIn(): Promise<void> {
		return invoke('providers.cancel-claude-sign-in', undefined);
	}
}

export const claudeSetupService = new ClaudeSetupService();
