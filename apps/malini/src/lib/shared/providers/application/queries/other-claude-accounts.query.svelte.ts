import { otherClaudeAccounts } from '$shared/providers/domain/claude-accounts';
import { claudeAccountsStore } from '$shared/providers/infrastructure/stores/claude-accounts.store.svelte';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { otherClaudeAccountsQuery };

class OtherClaudeAccountsQuery {
	public readonly data: readonly string[] = $derived(
		otherClaudeAccounts(
			claudeAccountsStore.remembered,
			providerCapabilitiesStore.capability?.account?.email ?? null,
		),
	);
}

const otherClaudeAccountsQuery = new OtherClaudeAccountsQuery();
