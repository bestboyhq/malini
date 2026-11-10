import type { SecretRequest } from '$contract/secrets';
import { showSecretRequestFailureCommand } from '$lib/secrets/application/commands/show-secret-request-failure.command';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { dismissSecretRequestCommand };

function dismissSecretRequestCommand(request: SecretRequest): void {
	secretRequestsAggregate.close(request.sessionId, request.id);
	secretSavesStore.clear(request.id);
	void secretsService
		.dismiss(request.id)
		.catch((error: unknown) => showSecretRequestFailureCommand(request, error));
}
