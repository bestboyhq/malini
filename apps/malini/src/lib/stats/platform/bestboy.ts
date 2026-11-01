import type { BestboyAccount, BestboyProfile, PublishedStats } from '$contract/stats';
import { isRecord } from '$main/db/rows';

export const BESTBOY_ORIGIN = 'https://bestboy.dev';

const REQUEST_TIMEOUT_MS = 15_000;
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

export type BestboyFetch = (url: string, init: RequestInit) => Promise<Response>;

export type BestboyMe = Readonly<{ account: BestboyAccount; profile: BestboyProfile }>;

export type ProfileChange = Readonly<{ handle?: string; public?: boolean }>;

export type BestboySession = Readonly<{ token: string; handle: string | null }>;

export type BestboyAccess = Readonly<{
	origin: string;
	fetch: BestboyFetch;
	session(): BestboySession | null;
	claimHandle(handle: string): Promise<string | null>;
	signedOut(): Promise<void>;
}>;

export class BestboyError extends Error {
	override readonly name = 'BestboyError';

	constructor(
		message: string,
		readonly status: number | null,
		readonly field: string | null = null,
	) {
		super(message);
	}

	get transient(): boolean {
		return this.status === null || TRANSIENT_STATUSES.has(this.status) || this.status >= 500;
	}

	get signedOut(): boolean {
		return this.status === 401;
	}
}

export function bestboyOrigin(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const local = packaged ? undefined : env['MALINI_BESTBOY_ORIGIN'];
	return (local || BESTBOY_ORIGIN).replace(/\/+$/u, '');
}

export class Bestboy {
	readonly #fetch: BestboyFetch;

	constructor(
		readonly origin: string,
		fetcher: BestboyFetch,
	) {
		this.#fetch = fetcher;
	}

	get host(): string {
		return new URL(this.origin).host;
	}

	loginUrl(challenge: string, state: string): string {
		return `${this.origin}/login?${new URLSearchParams({ app: 'malini', challenge, state })}`;
	}

	async token(code: string, verifier: string): Promise<string> {
		const reply = await this.#call(null, 'POST', '/api/auth/token', { code, verifier });
		const token = isRecord(reply) ? reply['token'] : null;
		if (typeof token !== 'string' || token.length === 0) {
			throw new BestboyError(`${this.host} signed you in but sent no token.`, 200);
		}
		return token;
	}

	async me(token: string): Promise<BestboyMe> {
		const reply = await this.#call(token, 'GET', '/api/me');
		const user = isRecord(reply) ? reply['user'] : null;
		const name = isRecord(user) ? user['name'] : null;
		const email = isRecord(user) ? user['email'] : null;
		if (typeof email !== 'string') {
			throw new BestboyError(`${this.host} sent an account without an email.`, 200);
		}
		return {
			account: { name: typeof name === 'string' && name.length > 0 ? name : email, email },
			profile: this.#profile(isRecord(reply) ? reply['profile'] : null),
		};
	}

	async putProfile(token: string, change: ProfileChange): Promise<BestboyProfile> {
		const reply = await this.#call(token, 'PUT', '/api/profile', change);
		return this.#profile(reply);
	}

	async putStats(token: string, stats: PublishedStats): Promise<void> {
		await this.#call(token, 'PUT', '/api/stats/malini', stats);
	}

	async deleteStats(token: string): Promise<void> {
		await this.#call(token, 'DELETE', '/api/stats/malini');
	}

	async logout(token: string): Promise<void> {
		await this.#call(token, 'POST', '/api/auth/logout');
	}

	#profile(value: unknown): BestboyProfile {
		const handle = isRecord(value) ? value['handle'] : null;
		const url = isRecord(value) ? value['url'] : null;
		return {
			handle: typeof handle === 'string' && handle.length > 0 ? handle : null,
			public: isRecord(value) && value['public'] === true,
			url: typeof url === 'string' && url.startsWith(`${this.origin}/@`) ? url : null,
		};
	}

	async #call(
		token: string | null,
		method: string,
		path: string,
		body?: unknown,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await this.#fetch(`${this.origin}${path}`, {
				method,
				headers: {
					'Content-Type': 'application/json',
					...(token === null ? {} : { Authorization: `Bearer ${token}` }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new BestboyError(`Malini could not reach ${this.host}: ${reason(error)}.`, null);
		}
		const reply: unknown = response.status === 204 ? null : await response.json().catch(() => null);
		if (response.ok) return reply;
		const error = isRecord(reply) ? reply['error'] : null;
		const field = isRecord(reply) ? reply['field'] : null;
		throw new BestboyError(
			typeof error === 'string' && error.length > 0
				? error
				: `${this.host} answered ${response.status}.`,
			response.status,
			typeof field === 'string' ? field : null,
		);
	}
}

function reason(error: unknown): string {
	if (error instanceof Error && error.name === 'TimeoutError') return 'it did not answer in time';
	return error instanceof Error ? error.message : String(error);
}
