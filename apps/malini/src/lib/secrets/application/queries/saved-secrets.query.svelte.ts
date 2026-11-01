import type { SavedSecret } from '$contract/secrets';
import { savedSecretsAggregate } from '$lib/secrets/infrastructure/aggregates/saved-secrets.aggregate.svelte';

export { savedSecretsQuery };

type SavedSecretsListing = Readonly<{
	secrets: readonly SavedSecret[] | null;
	failure: string | null;
}>;

class SavedSecretsQuery {
	public readonly data: SavedSecretsListing = $derived({
		secrets: savedSecretsAggregate.secrets,
		failure: savedSecretsAggregate.failure,
	});
}

const savedSecretsQuery = new SavedSecretsQuery();
