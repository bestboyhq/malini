import type { ClaudeAccountSwitchOutcome, ClaudeSignInOutcome } from '$contract/agent';
import {
	PROVIDERS_CLAUDE_CODE_INSTALL_PROGRESS_CHANNEL,
	type InstallProgressPayload,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class ClaudeSetupService {
	install(): Promise<void> {
		return invoke('providers.install-claude-code', undefined);
	}

	onInstallProgress(listener: (progress: InstallProgressPayload) => void): () => void {
		return onPlatformEvent(PROVIDERS_CLAUDE_CODE_INSTALL_PROGRESS_CHANNEL, listener);
	}

	signIn(email: string | null): Promise<ClaudeSignInOutcome> {
		return invoke('providers.sign-in-to-claude', email ? { email } : {});
	}

	switchAccount(email: string): Promise<ClaudeAccountSwitchOutcome> {
		return invoke('providers.switch-claude-account', { email });
	}

	cancelSignIn(): Promise<void> {
		return invoke('providers.cancel-claude-sign-in', undefined);
	}
}

export const claudeSetupService = new ClaudeSetupService();
