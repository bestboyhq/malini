import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { checkingClaudeCodeAgainQuery };

class CheckingClaudeCodeAgainQuery {
	public readonly data: boolean = $derived(providerCapabilitiesStore.checkingAgain);
}

const checkingClaudeCodeAgainQuery = new CheckingClaudeCodeAgainQuery();
