import type { SecretRequest } from '$contract/secrets';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { saveRequestedSecretsCommand };

function saveRequestedSecretsCommand(
	request: SecretRequest,
	values: Readonly<Record<string, string>>,
	everywhere: boolean,
): void {
	if (secretSavesStore.saves.get(request.id)?.status === 'saving') return;
	secretSavesStore.set(request.id, { status: 'saving' });
	void (async () => {
		try {
			await secretsService.save({
				requestId: request.id,
				repository: everywhere ? null : request.repository,
				values,
			});
			secretSavesStore.clear(request.id);
			secretRequestsAggregate.close(request.sessionId, request.id);
		} catch (error) {
			secretSavesStore.set(request.id, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
