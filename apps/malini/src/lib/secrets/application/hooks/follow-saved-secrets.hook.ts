import { savedSecretsAggregate } from '$lib/secrets/infrastructure/aggregates/saved-secrets.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';

export function followSavedSecretsHook(): () => void {
	void load();
	return secretsService.onSavedChanged(() => void load());
}

async function load(): Promise<void> {
	try {
		savedSecretsAggregate.replace(await secretsService.list());
	} catch (error) {
		savedSecretsAggregate.fail(error instanceof Error ? error.message : String(error));
	}
}
