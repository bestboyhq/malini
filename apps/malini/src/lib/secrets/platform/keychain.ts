import type { SavedSecret } from '$contract/secrets';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { osFor } from '$shared/os/os.platform';
import {
	allSealedSecrets,
	deleteSecret,
	listSecrets,
	sealedSecretsReaching,
	upsertSecret,
} from './secrets.repository';

export interface SecretSealer {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

export class Keychain {
	readonly #db: MaliniDatabase;
	readonly #sealer: SecretSealer;

	constructor(db: MaliniDatabase, sealer: SecretSealer) {
		this.#db = db;
		this.#sealer = sealer;
	}

	save(repository: string | null, values: Readonly<Record<string, string>>): void {
		if (!this.#sealer.isEncryptionAvailable()) {
			const os = osFor(process.platform);
			throw new Error(
				`Malini cannot reach ${os.secretStore} to seal secrets. ${os.unlockSecretStore}, then save again.`,
			);
		}
		const savedAt = nowIso8601();
		const sealed = Object.entries(values).map(
			([name, value]) => [name, this.#sealer.encryptString(value)] as const,
		);
		this.#db.transaction(() => {
			for (const [name, value] of sealed) upsertSecret(this.#db, repository, name, value, savedAt);
		});
	}

	delete(repository: string | null, name: string): boolean {
		return deleteSecret(this.#db, repository, name);
	}

	list(): SavedSecret[] {
		return listSecrets(this.#db);
	}

	namesReaching(repository: string | null): string[] {
		return [...new Set(sealedSecretsReaching(this.#db, repository).map(({ name }) => name))];
	}

	valuesReaching(repository: string | null): Record<string, string> {
		if (!this.#sealer.isEncryptionAvailable()) return {};
		const values: Record<string, string> = {};
		for (const { name, sealed } of sealedSecretsReaching(this.#db, repository)) {
			const value = this.#opened(sealed);
			if (value !== null) values[name] = value;
		}
		return values;
	}

	allValues(): string[] {
		if (!this.#sealer.isEncryptionAvailable()) return [];
		return allSealedSecrets(this.#db).flatMap((sealed) => this.#opened(sealed) ?? []);
	}

	#opened(sealed: Uint8Array): string | null {
		try {
			return this.#sealer.decryptString(Buffer.from(sealed));
		} catch {
			return null;
		}
	}
}
