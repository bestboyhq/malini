import type { ModelProviderRecord } from '$contract/agent';
import type { MaliniDatabase } from '$main/db/driver';
import {
	CLAUDE_PROVIDER,
	CLAUDE_PROVIDER_ID,
	isValidProviderId,
} from '$shared/providers/domain/provider';
import { providerEnvironment } from '$shared/providers/domain/provider-env';
import type { SecretCipher } from './claude-accounts.service';
import {
	clearProviderKey,
	getStoredProvider,
	listStoredProviders,
	setProviderKey,
	type StoredProvider,
} from './provider.repository';

const MAX_API_KEY_LENGTH = 8_192;

export class ProviderKeys {
	readonly #db: MaliniDatabase;
	readonly #cipher: () => Promise<SecretCipher>;

	constructor(db: MaliniDatabase, cipher: () => Promise<SecretCipher>) {
		this.#db = db;
		this.#cipher = cipher;
	}

	list(): ModelProviderRecord[] {
		const providers = listStoredProviders(this.#db).map((provider) => ({
			id: provider.id,
			name: provider.name,
			kind: provider.kind,
			baseUrl: provider.baseUrl,
			models: [...provider.models],
			keySaved: provider.sealedKey !== null,
		}));
		return [CLAUDE_PROVIDER, ...providers];
	}

	async save(providerId: string, apiKey: string): Promise<void> {
		const provider = this.#customProvider(providerId);
		const key = apiKey.trim();
		if (key.length === 0 || key.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/u.test(key)) {
			throw new Error('The API key is not valid.');
		}
		const cipher = await this.#cipher();
		if (!cipher.isEncryptionAvailable()) {
			throw new Error(
				'Malini cannot reach the macOS keychain to seal the API key. Unlock it, then save again.',
			);
		}
		if (!setProviderKey(this.#db, provider.id, cipher.encryptString(key))) {
			throw new Error(`Unknown provider \`${provider.id}\``);
		}
	}

	delete(providerId: string): void {
		const provider = this.#customProvider(providerId);
		if (!clearProviderKey(this.#db, provider.id)) {
			throw new Error(`Unknown provider \`${provider.id}\``);
		}
	}

	async environment(providerId: string, model: string): Promise<Record<string, string>> {
		if (providerId === CLAUDE_PROVIDER_ID) return {};
		const provider = this.#customProvider(providerId);
		if (!provider.models.some((candidate) => candidate.id === model)) {
			throw new Error(`${provider.name} does not offer model \`${model}\``);
		}
		return providerEnvironment({
			name: provider.name,
			kind: provider.kind,
			baseUrl: provider.baseUrl,
			apiKey: await this.#decryptedKey(provider),
			model,
			subagentModel: provider.subagentModel,
		});
	}

	async #decryptedKey(provider: StoredProvider): Promise<string | null> {
		if (provider.sealedKey === null) return null;
		const cipher = await this.#cipher();
		if (!cipher.isEncryptionAvailable()) {
			throw new Error(
				`The ${provider.name} API key cannot be read because the macOS keychain is locked.`,
			);
		}
		try {
			return cipher.decryptString(Buffer.from(provider.sealedKey));
		} catch {
			throw new Error(`The ${provider.name} API key cannot be read. Save it again in Settings.`);
		}
	}

	#customProvider(providerId: string): StoredProvider {
		if (!isValidProviderId(providerId) || providerId === CLAUDE_PROVIDER_ID) {
			throw new Error(`Unknown provider \`${providerId}\``);
		}
		const provider = getStoredProvider(this.#db, providerId);
		if (!provider) throw new Error(`Unknown provider \`${providerId}\``);
		return provider;
	}
}
