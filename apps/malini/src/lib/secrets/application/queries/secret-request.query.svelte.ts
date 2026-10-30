import type { SecretRequest } from '$contract/secrets';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';

export { secretRequestQuery };

class SecretRequestQuery {
	public readonly data: (sessionId: string | null) => SecretRequest | null = $derived(
		(sessionId: string | null) =>
			sessionId === null ? null : (secretRequestsAggregate.bySession.get(sessionId) ?? null),
	);
}

const secretRequestQuery = new SecretRequestQuery();
