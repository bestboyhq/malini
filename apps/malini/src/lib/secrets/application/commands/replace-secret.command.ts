import type { SavedSecret } from '$contract/secrets';
import { savedSecretKey } from '$lib/secrets/domain/secret-save';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { replaceSecretCommand };

function replaceSecretCommand(secret: SavedSecret, value: string): void {
	const key = savedSecretKey(secret.name, secret.repository);
	secretSavesStore.set(key, { status: 'saving' });
	void (async () => {
		try {
			await secretsService.save({
				repository: secret.repository,
				values: { [secret.name]: value },
			});
			secretSavesStore.clear(key);
		} catch (error) {
			secretSavesStore.set(key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
