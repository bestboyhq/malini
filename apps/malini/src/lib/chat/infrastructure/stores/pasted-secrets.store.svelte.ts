import type { PastedSecret, SecretPasteLanding } from '$lib/chat/domain/pasted-secrets';

class PastedSecretsStore {
	pasted: readonly PastedSecret[] = $state([]);
	landings: Readonly<Record<string, SecretPasteLanding>> = $state({});

	find(id: string): PastedSecret | null {
		return this.pasted.find((secret) => secret.id === id) ?? null;
	}

	put(secret: PastedSecret): void {
		this.pasted = [...this.pasted.filter((kept) => kept.id !== secret.id), secret];
	}

	land(key: string, landing: SecretPasteLanding): void {
		this.landings = { ...this.landings, [key]: landing };
	}

	takeLanding(key: string): SecretPasteLanding | null {
		const landing = this.landings[key] ?? null;
		this.landings = Object.fromEntries(
			Object.entries(this.landings).filter(([landed]) => landed !== key),
		);
		return landing;
	}
}

export const pastedSecretsStore = new PastedSecretsStore();
