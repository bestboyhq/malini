import type { SecretSave } from '$lib/secrets/domain/secret-save';

class SecretSavesStore {
	saves = $state.raw<ReadonlyMap<string, SecretSave>>(new Map());

	set(key: string, save: SecretSave): void {
		this.saves = new Map(this.saves).set(key, save);
	}

	clear(key: string): void {
		if (!this.saves.has(key)) return;
		const next = new Map(this.saves);
		next.delete(key);
		this.saves = next;
	}
}

export const secretSavesStore = new SecretSavesStore();
