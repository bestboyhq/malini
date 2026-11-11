import type { SecretRequest } from '$contract/secrets';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { showSecretRequestFailureCommand };

function showSecretRequestFailureCommand(request: SecretRequest, error: unknown): void {
	void (async () => {
		const open = await secretsService.listRequests(request.sessionId).catch(() => [request]);
		secretRequestsAggregate.replace(request.sessionId, open);
		if (!open.some(({ id }) => id === request.id)) {
			secretSavesStore.clear(request.id);
			return;
		}
		secretSavesStore.set(request.id, {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		});
	})();
}
