import {
	rememberClaudeAccount,
	type ClaudeSignInState,
} from '$shared/providers/domain/claude-accounts';
import { claudeAccountsStorage } from '$shared/providers/infrastructure/services/claude-accounts.storage';

class ClaudeAccountsStore {
	remembered: readonly string[] = $state(claudeAccountsStorage.read());
	signIn: ClaudeSignInState = $state('idle');

	remember(email: string | undefined): void {
		if (!email || this.remembered[0] === email) return;
		this.remembered = rememberClaudeAccount(this.remembered, email);
		claudeAccountsStorage.write(this.remembered);
	}
}

export const claudeAccountsStore = new ClaudeAccountsStore();
