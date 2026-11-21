import type { SecretPasteLanding } from '$lib/chat/domain/pasted-secrets';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';

export { secretPasteLandingsQuery };

class SecretPasteLandingsQuery {
	public readonly data: Readonly<Record<string, SecretPasteLanding>> = $derived(
		pastedSecretsStore.landings,
	);
}

const secretPasteLandingsQuery = new SecretPasteLandingsQuery();
