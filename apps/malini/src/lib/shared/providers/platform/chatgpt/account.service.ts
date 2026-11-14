import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentModelInfo, ChatGptSignInOutcome, ProviderAccount } from '$contract/agent';
import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, run } from '$main/db/rows';
import { osFor } from '$shared/os/os.platform';
import { isValidAgentModel } from '$shared/providers/domain/model-id';
import { modelDescription } from '$shared/providers/domain/models-dev';
import { AGENT_REASONING_EFFORTS } from '$shared/providers/domain/run-profile';
import type { SecretCipher } from '../claude-accounts.service';
import { setProviderModels } from '../provider.repository';
import {
	ChatGptError,
	type ChatGptAuth,
	type ChatGptConnection,
	type ChatGptCredentials,
	type ChatGptEndpoints,
	type ChatGptFetch,
} from './sign-in';

export const CHATGPT_PROVIDER_ID = 'chatgpt';

const EXPIRY_MARGIN_MS = 60_000;
const MODELS_INTERVAL_MS = 60 * 60 * 1000;
const MAX_MODELS = 100;

interface AccountRow {
	host_id: string;
	client_id: string | null;
	subject: string | null;
	email: string | null;
	name: string | null;
	credentials: Uint8Array | null;
}

const sealedCredentials = z.object({
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
	expiresAt: z.number(),
	scopes: z.array(z.string()),
	unverifiedIdToken: z.object({ token: z.string(), receivedAt: z.number() }).nullable(),
});

type SealedCredentials = z.infer<typeof sealedCredentials>;

const remoteModels = z.object({
	models: z.array(
		z.object({
			slug: z.string(),
			display_name: z.string().min(1).max(80),
			visibility: z.string(),
			supported_in_api: z.boolean().exactOptional(),
			context_window: z.number().exactOptional(),
			input_modalities: z.array(z.string()).exactOptional(),
			supported_reasoning_levels: z.array(z.object({ effort: z.string() })).exactOptional(),
		}),
	),
});

export interface ChatGptAccountDeps {
	readonly db: MaliniDatabase;
	readonly cipher: () => Promise<SecretCipher>;
	readonly auth: ChatGptAuth;
	readonly endpoints: ChatGptEndpoints;
	readonly fetch: ChatGptFetch;
	readonly now?: () => number;
}

export class ChatGptAccount {
	readonly #deps: ChatGptAccountDeps;
	readonly #now: () => number;
	#signIn: AbortController | null = null;
	#refreshing: Promise<string> | null = null;
	#modelsCheckedAt = Number.NEGATIVE_INFINITY;
	#listing: Promise<void> | null = null;
	#usageLimitReachedAt: string | null = null;

	constructor(deps: ChatGptAccountDeps) {
		this.#deps = deps;
		this.#now = deps.now ?? Date.now;
	}

	account(): ProviderAccount | null {
		const row = this.#row();
		if (!row?.credentials) return null;
		return { email: row.email, name: row.name, usageLimitReachedAt: this.#usageLimitReachedAt };
	}

	async signIn(): Promise<ChatGptSignInOutcome> {
		this.cancelSignIn();
		const controller = new AbortController();
		this.#signIn = controller;
		try {
			await this.#readyCipher();
			const row = this.#row() ?? this.#createRow();
			const connection = await this.#deps.auth.authorize(
				{ clientId: row.client_id, subject: row.subject, email: row.email },
				row.host_id,
				controller.signal,
				(clientId) => this.#saveClientId(clientId),
			);
			await this.#saveConnection(connection, null);
			this.#usageLimitReachedAt = null;
			this.#modelsCheckedAt = Number.NEGATIVE_INFINITY;
			await this.refreshModels().catch(() => undefined);
			return 'signed-in';
		} catch (error) {
			if (error instanceof ChatGptError && error.code === 'cancelled') return 'cancelled';
			throw error;
		} finally {
			if (this.#signIn === controller) this.#signIn = null;
		}
	}

	cancelSignIn(): void {
		this.#signIn?.abort();
		this.#signIn = null;
	}

	async signOut(): Promise<void> {
		this.cancelSignIn();
		const stored = await this.#stored().catch(() => null);
		run(
			this.#deps.db,
			`UPDATE chatgpt_account SET client_id = NULL, subject = NULL, email = NULL, name = NULL,
			 credentials = NULL, updated_at = ? WHERE id = 1`,
			nowIso8601(),
		);
		this.#usageLimitReachedAt = null;
		if (stored && !(await this.#deps.auth.revoke(stored.connection))) {
			throw new Error(
				'Malini forgot your ChatGPT sign-in, but ChatGPT did not confirm it. Remove Malini in ChatGPT, Settings, Apps.',
			);
		}
	}

	accessToken(force = false): Promise<string> {
		this.#refreshing ??= this.#validAccessToken(force).finally(() => {
			this.#refreshing = null;
		});
		return this.#refreshing;
	}

	noteUsageLimit(reached: boolean): void {
		this.#usageLimitReachedAt = reached
			? (this.#usageLimitReachedAt ?? new Date(this.#now()).toISOString())
			: null;
	}

	refreshModels(): Promise<void> {
		this.#listing ??= this.#listModels().finally(() => {
			this.#listing = null;
		});
		return this.#listing;
	}

	async #listModels(): Promise<void> {
		if (!this.#row()?.credentials) return;
		if (this.#now() - this.#modelsCheckedAt < MODELS_INTERVAL_MS) return;
		const response = await this.#deps.fetch(`${this.#deps.endpoints.resource}/models`, {
			headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) return;
		const models = chatGptModels(await response.json());
		this.#modelsCheckedAt = this.#now();
		if (models.length > 0) setProviderModels(this.#deps.db, CHATGPT_PROVIDER_ID, models);
	}

	async #validAccessToken(force: boolean): Promise<string> {
		const { connection, pending } = await this.#stored();
		if (pending) await this.#verify(connection, pending);
		if (!force && connection.credentials.expiresAt - EXPIRY_MARGIN_MS > this.#now()) {
			return connection.credentials.accessToken;
		}
		try {
			const refreshed = await this.#deps.auth.refresh(connection);
			const pending = refreshed.idToken
				? { token: refreshed.idToken, receivedAt: refreshed.receivedAt }
				: null;
			await this.#saveConnection({ ...connection, credentials: refreshed.credentials }, pending);
			if (pending)
				await this.#verify({ ...connection, credentials: refreshed.credentials }, pending);
			return refreshed.credentials.accessToken;
		} catch (error) {
			if (error instanceof ChatGptError && error.needsSignIn) this.#forgetCredentials();
			throw error;
		}
	}

	async #verify(
		connection: ChatGptConnection,
		pending: NonNullable<SealedCredentials['unverifiedIdToken']>,
	): Promise<void> {
		const identity = await this.#deps.auth.verifyIdentity(
			pending.token,
			connection.clientId,
			undefined,
			pending.receivedAt,
		);
		if (identity.subject !== connection.identity.subject) {
			this.#forgetCredentials();
			throw new ChatGptError(
				'account_mismatch',
				'ChatGPT switched accounts under Malini. Sign in again.',
			);
		}
		await this.#saveConnection({ ...connection, identity }, null);
	}

	async #stored(): Promise<{
		connection: ChatGptConnection;
		pending: SealedCredentials['unverifiedIdToken'];
	}> {
		const row = this.#row();
		if (!row?.client_id || !row.subject || !row.credentials) {
			throw new ChatGptError('signed_out', 'Sign in to ChatGPT in Settings, then try again.');
		}
		const sealed = await this.#unseal(row.credentials);
		return {
			connection: {
				clientId: row.client_id,
				identity: { subject: row.subject, email: row.email, name: row.name },
				credentials: sealed,
			},
			pending: sealed.unverifiedIdToken,
		};
	}

	async #unseal(credentials: Uint8Array): Promise<SealedCredentials> {
		const cipher = await this.#readyCipher();
		try {
			return sealedCredentials.parse(JSON.parse(cipher.decryptString(Buffer.from(credentials))));
		} catch {
			this.#forgetCredentials();
			throw new ChatGptError(
				'unreadable_credentials',
				'Malini cannot read your ChatGPT sign-in. Sign in again in Settings.',
			);
		}
	}

	async #saveConnection(
		connection: ChatGptConnection,
		unverifiedIdToken: SealedCredentials['unverifiedIdToken'],
	): Promise<void> {
		const cipher = await this.#readyCipher();
		const sealed = cipher.encryptString(
			JSON.stringify(sealedValue(connection.credentials, unverifiedIdToken)),
		);
		const { identity } = connection;
		run(
			this.#deps.db,
			`UPDATE chatgpt_account SET client_id = ?, subject = ?, email = ?, name = ?, credentials = ?,
			 updated_at = ? WHERE id = 1`,
			connection.clientId,
			identity.subject,
			identity.email,
			identity.name,
			sealed,
			nowIso8601(),
		);
	}

	#saveClientId(clientId: string): void {
		run(
			this.#deps.db,
			'UPDATE chatgpt_account SET client_id = ?, updated_at = ? WHERE id = 1',
			clientId,
			nowIso8601(),
		);
	}

	#forgetCredentials(): void {
		run(
			this.#deps.db,
			'UPDATE chatgpt_account SET credentials = NULL, updated_at = ? WHERE id = 1',
			nowIso8601(),
		);
	}

	async #readyCipher(): Promise<SecretCipher> {
		const cipher = await this.#deps.cipher();
		if (!cipher.isEncryptionAvailable()) {
			const os = osFor(process.platform);
			throw new Error(
				`Malini cannot reach ${os.secretStore} to keep your ChatGPT sign-in. ${os.unlockSecretStore}, then try again.`,
			);
		}
		return cipher;
	}

	#row(): AccountRow | null {
		return (
			get<AccountRow>(
				this.#deps.db,
				'SELECT host_id, client_id, subject, email, name, credentials FROM chatgpt_account WHERE id = 1',
			) ?? null
		);
	}

	#createRow(): AccountRow {
		const hostId = `urn:uuid:${randomUUID()}`;
		run(
			this.#deps.db,
			'INSERT INTO chatgpt_account (id, host_id, updated_at) VALUES (1, ?, ?)',
			hostId,
			nowIso8601(),
		);
		return {
			host_id: hostId,
			client_id: null,
			subject: null,
			email: null,
			name: null,
			credentials: null,
		};
	}
}

function sealedValue(
	credentials: ChatGptCredentials,
	unverifiedIdToken: SealedCredentials['unverifiedIdToken'],
): SealedCredentials {
	return {
		accessToken: credentials.accessToken,
		refreshToken: credentials.refreshToken,
		expiresAt: credentials.expiresAt,
		scopes: [...credentials.scopes],
		unverifiedIdToken,
	};
}

export function chatGptModels(body: unknown): AgentModelInfo[] {
	const parsed = remoteModels.safeParse(body);
	if (!parsed.success) return [];
	return parsed.data.models
		.filter(
			(model) =>
				model.visibility === 'list' &&
				model.supported_in_api !== false &&
				isValidAgentModel(model.slug),
		)
		.slice(0, MAX_MODELS)
		.map((model) => {
			const levels = new Set((model.supported_reasoning_levels ?? []).map(({ effort }) => effort));
			return {
				id: model.slug,
				label: chatGptLabel(model.display_name),
				description: modelDescription(model.input_modalities ?? ['text'], model.context_window),
				efforts: AGENT_REASONING_EFFORTS.filter((effort) => levels.has(effort)),
				family: chatGptFamily(model.slug),
			};
		});
}

function chatGptLabel(displayName: string): string {
	return displayName.replace(
		/^(GPT-\d+(?:\.\d+)*)-(.+)$/u,
		(_, version: string, name: string) => `${version} ${name.replaceAll('-', ' ')}`,
	);
}

export function chatGptFamily(slug: string): string {
	return slug.replace(/^gpt-\d+(?:\.\d+)*/u, 'gpt');
}
