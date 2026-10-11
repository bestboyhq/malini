import type { ClaudeSignInState } from '$shared/providers/domain/claude-accounts';
import { claudeAccountsStore } from '$shared/providers/infrastructure/stores/claude-accounts.store.svelte';

export { claudeSignInQuery };

class ClaudeSignInQuery {
	public readonly data: ClaudeSignInState = $derived(claudeAccountsStore.signIn);
}

const claudeSignInQuery = new ClaudeSignInQuery();
