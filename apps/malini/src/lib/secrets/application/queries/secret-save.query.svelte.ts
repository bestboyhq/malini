import type { SecretSave } from '$lib/secrets/domain/secret-save';
import { secretSavesStore } from '$lib/secrets/infrastructure/stores/secret-saves.store.svelte';

export { secretSaveQuery };

class SecretSaveQuery {
	public readonly data: (key: string) => SecretSave | null = $derived(
		(key: string) => secretSavesStore.saves.get(key) ?? null,
	);
}

const secretSaveQuery = new SecretSaveQuery();
