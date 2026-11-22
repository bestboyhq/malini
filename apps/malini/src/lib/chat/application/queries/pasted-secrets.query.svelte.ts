import { pastedSecretInText, type PastedSecret } from '$lib/chat/domain/pasted-secrets';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';

export { pastedSecretsQuery };

class PastedSecretsQuery {
	public readonly data: (draftScope: string) => readonly PastedSecret[] = $derived(
		(draftScope: string) => {
			const text = agentDrafts.draftFor(draftScope).text;
			return pastedSecretsStore.pasted.filter(
				(secret) => secret.draftScope === draftScope && pastedSecretInText(secret, text),
			);
		},
	);
}

const pastedSecretsQuery = new PastedSecretsQuery();
