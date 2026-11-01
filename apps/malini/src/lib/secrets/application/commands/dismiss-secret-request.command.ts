import type { SecretRequest } from '$contract/secrets';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { dismissSecretRequestCommand };

function dismissSecretRequestCommand(request: SecretRequest): void {
	secretRequestsAggregate.close(request.sessionId, request.id);
	secretSavesStore.clear(request.id);
	void (async () => {
		try {
			await secretsService.dismiss(request.id);
		} catch (error) {
			secretRequestsAggregate.open(request);
			secretSavesStore.set(request.id, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
