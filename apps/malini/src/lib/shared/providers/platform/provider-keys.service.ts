import type {
	AgentPlanUsage,
	ModelProviderRecord,
	ProviderAccount,
	ProviderPlan,
} from '$contract/agent';
import type { MaliniDatabase } from '$main/db/driver';
import { osFor } from '$shared/os/os.platform';
import {
	CLAUDE_PROVIDER,
	CLAUDE_PROVIDER_ID,
	OPENCODE_GO_PROVIDER_ID,
	OPENCODE_PROVIDER_ID,
	isValidProviderId,
} from '$shared/providers/domain/provider';
import {
	missingKey,
	ProviderNotConnectedError,
	providerEnvironment,
} from '$shared/providers/domain/provider-env';
import type { SecretCipher } from './claude-accounts.service';
import type { KeyUpstream } from './key-proxy';
import type { ProxyAddress } from './local-endpoint';
import {
	clearProviderKey,
	getStoredProvider,
	listStoredProviders,
	setProviderKey,
	setProviderPlan,
	type StoredProvider,
} from './provider.repository';

const MAX_API_KEY_LENGTH = 8_192;
const PLAN_RETRY_MS = 60 * 60 * 1000;

export type PlanDetector = (apiKey: string) => Promise<ProviderPlan | null>;

export interface SignedInProvider {
	account(): ProviderAccount | null;
	endpoint(): Promise<ProxyAddress>;
}

export interface ProviderProxies {
	readonly chatgpt: SignedInProvider;
	readonly keys: (providerId: string) => Promise<ProxyAddress>;
}

type SessionOpening = 'new' | 'reopened';

const SIGNED_OUT: SignedInProvider = {
	account: () => null,
	endpoint: () => Promise.reject(new Error('Sign in to ChatGPT in Settings, then try again.')),
};

const NO_KEY_PROXY = (): Promise<ProxyAddress> =>
	Promise.reject(new Error('Malini has no proxy for API keys.'));

export class ProviderKeys {
	readonly #db: MaliniDatabase;
	readonly #cipher: () => Promise<SecretCipher>;
	readonly #detectPlan: PlanDetector;
	readonly #chatgpt: SignedInProvider;
	readonly #keyProxy: (providerId: string) => Promise<ProxyAddress>;
	readonly #now: () => number;
	#planUnknownAt = Number.NEGATIVE_INFINITY;

	constructor(
		db: MaliniDatabase,
		cipher: () => Promise<SecretCipher>,
		detectPlan: PlanDetector,
		proxies: Partial<ProviderProxies> = {},
		now: () => number = Date.now,
	) {
		this.#db = db;
		this.#cipher = cipher;
		this.#detectPlan = detectPlan;
		this.#chatgpt = proxies.chatgpt ?? SIGNED_OUT;
		this.#keyProxy = proxies.keys ?? NO_KEY_PROXY;
		this.#now = now;
	}

	list(): ModelProviderRecord[] {
		const providers = listStoredProviders(this.#db)
			.filter((provider) => provider.id !== OPENCODE_GO_PROVIDER_ID)
			.map((provider) => {
				const served = this.#servedBy(provider);
				return {
					id: provider.id,
					name: provider.name,
					kind: provider.kind,
					baseUrl: served.baseUrl,
					models: [...served.models],
					keySaved: provider.sealedKey !== null,
					account: provider.kind === 'chatgpt' ? this.#chatgpt.account() : null,
					plan: provider.plan,
				};
			});
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
			const os = osFor(process.platform);
			throw new Error(
				`Malini cannot reach ${os.secretStore} to seal the API key. ${os.unlockSecretStore}, then save again.`,
			);
		}
		const plan = provider.id === OPENCODE_PROVIDER_ID ? await this.#askPlan(key) : null;
		if (!setProviderKey(this.#db, provider.id, cipher.encryptString(key), plan)) {
			throw new Error(`Unknown provider \`${provider.id}\``);
		}
	}

	delete(providerId: string): void {
		const provider = this.#customProvider(providerId);
		if (!clearProviderKey(this.#db, provider.id)) {
			throw new Error(`Unknown provider \`${provider.id}\``);
		}
	}

	async checkPlan(providerId: string): Promise<void> {
		const provider = this.#customProvider(providerId);
		if (provider.id !== OPENCODE_PROVIDER_ID) {
			throw new Error(`${provider.name} has no plan to check.`);
		}
		await this.#adoptPlan(provider);
	}

	async detectMissingPlan(): Promise<void> {
		const provider = getStoredProvider(this.#db, OPENCODE_PROVIDER_ID);
		if (!provider || provider.sealedKey === null || provider.plan !== null) return;
		if (this.#now() - this.#planUnknownAt < PLAN_RETRY_MS) return;
		await this.#adoptPlan(provider).catch(() => undefined);
	}

	async opencodeUsage(
		load: (apiKey: string) => Promise<AgentPlanUsage | null>,
	): Promise<AgentPlanUsage | null> {
		const provider = getStoredProvider(this.#db, OPENCODE_PROVIDER_ID);
		if (!provider || provider.plan !== 'go' || provider.sealedKey === null) return null;
		try {
			const apiKey = await this.#decryptedKey(provider);
			if (apiKey === null) return null;
			return await load(apiKey);
		} catch {
			return null;
		}
	}

	async environment(
		providerId: string,
		model: string,
		session: SessionOpening = 'new',
	): Promise<Record<string, string>> {
		if (providerId === CLAUDE_PROVIDER_ID) return {};
		const provider = this.#customProvider(providerId);
		const served = this.#servedBy(provider);
		if (session === 'new' && !served.models.some((candidate) => candidate.id === model)) {
			throw new ProviderNotConnectedError(`${provider.name} does not offer model \`${model}\``);
		}
		const endpoint =
			provider.kind === 'chatgpt'
				? await this.#chatgpt.endpoint()
				: await this.#keyEndpoint(provider.id);
		return providerEnvironment({
			name: provider.name,
			kind: provider.kind,
			baseUrl: endpoint.baseUrl,
			apiKey: endpoint.token,
			model,
			subagentModel: served.models.some(({ id }) => id === served.subagentModel)
				? served.subagentModel
				: null,
		});
	}

	async upstream(providerId: string): Promise<KeyUpstream> {
		const provider = this.#customProvider(providerId);
		if (provider.kind !== 'anthropic') throw new Error(`Unknown provider \`${providerId}\``);
		const { baseUrl } = this.#servedBy(provider);
		if (baseUrl === null) throw new Error(`${provider.name} has no base URL`);
		const apiKey = await this.#decryptedKey(provider);
		if (apiKey === null) throw missingKey(provider.name);
		return { baseUrl, apiKey };
	}

	async #keyEndpoint(providerId: string): Promise<ProxyAddress> {
		await this.upstream(providerId);
		return this.#keyProxy(providerId);
	}

	async #adoptPlan(provider: StoredProvider): Promise<void> {
		const key = await this.#decryptedKey(provider);
		if (key === null || provider.sealedKey === null) {
			throw new Error('Save an OpenCode API key first.');
		}
		const plan = await this.#askPlan(key);
		if (plan !== null) setProviderPlan(this.#db, provider.id, provider.sealedKey, plan);
	}

	async #askPlan(key: string): Promise<ProviderPlan | null> {
		const plan = await this.#detectPlan(key).catch((error: unknown) => {
			this.#planUnknownAt = this.#now();
			throw error;
		});
		this.#planUnknownAt = plan === null ? this.#now() : Number.NEGATIVE_INFINITY;
		return plan;
	}

	#servedBy(provider: StoredProvider): StoredProvider {
		if (provider.id !== OPENCODE_PROVIDER_ID || provider.plan !== 'go') return provider;
		return getStoredProvider(this.#db, OPENCODE_GO_PROVIDER_ID) ?? provider;
	}

	async #decryptedKey(provider: StoredProvider): Promise<string | null> {
		if (provider.sealedKey === null) return null;
		const cipher = await this.#cipher();
		if (!cipher.isEncryptionAvailable()) {
			throw new Error(
				`The ${provider.name} API key cannot be read because ${osFor(process.platform).secretStore} is locked.`,
			);
		}
		try {
			return cipher.decryptString(Buffer.from(provider.sealedKey));
		} catch {
			throw new Error(`The ${provider.name} API key cannot be read. Save it again in Settings.`);
		}
	}

	#customProvider(providerId: string): StoredProvider {
		if (
			!isValidProviderId(providerId) ||
			providerId === CLAUDE_PROVIDER_ID ||
			providerId === OPENCODE_GO_PROVIDER_ID
		) {
			throw new Error(`Unknown provider \`${providerId}\``);
		}
		const provider = getStoredProvider(this.#db, providerId);
		if (!provider) throw new Error(`Unknown provider \`${providerId}\``);
		return provider;
	}
}
