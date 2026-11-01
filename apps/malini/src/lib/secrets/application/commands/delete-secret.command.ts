import type { SavedSecret } from '$contract/secrets';
import { savedSecretKey } from '$lib/secrets/domain/secret-save';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { deleteSecretCommand };

function deleteSecretCommand(secret: SavedSecret): void {
	const key = savedSecretKey(secret.name, secret.repository);
	secretSavesStore.set(key, { status: 'saving' });
	void (async () => {
		try {
			await secretsService.remove({ name: secret.name, repository: secret.repository });
			secretSavesStore.clear(key);
		} catch (error) {
			secretSavesStore.set(key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
