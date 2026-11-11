import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BestboyAccount, BestboyProfile, StatsPublishing } from '$contract/stats';
import { isRecord } from '$main/db/rows';

export const PROFILE_FILE = 'bestboy-profile.json';

export interface TokenCipher {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

export type PendingSignIn = Readonly<{ verifier: string; state: string; until: number }>;

export type SavedProfile = Readonly<{
	token: string;
	account: BestboyAccount | null;
	profile: BestboyProfile | null;
	unacceptedTerms: string | null;
	acceptedUserId: string | null;
	publishing: StatsPublishing;
	publishedThrough: string | null;
	picked: readonly string[];
	signIn: PendingSignIn | null;
}>;

export const SIGNED_OUT: SavedProfile = {
	token: '',
	account: null,
	profile: null,
	unacceptedTerms: null,
	acceptedUserId: null,
	publishing: 'off',
	publishedThrough: null,
	picked: [],
	signIn: null,
};

export class ProfileStore {
	readonly #path: string;
	readonly #cipher: TokenCipher;
	#writes: Promise<void> = Promise.resolve();

	constructor(appDataRoot: string, cipher: TokenCipher) {
		this.#path = join(appDataRoot, PROFILE_FILE);
		this.#cipher = cipher;
	}

	load(): SavedProfile {
		let saved: unknown;
		try {
			saved = JSON.parse(readFileSync(this.#path, 'utf8'));
		} catch {
			return SIGNED_OUT;
		}
		if (!isRecord(saved)) return SIGNED_OUT;
		const token = this.#unseal(saved['token']);
		return {
			token,
			account: token ? account(saved['account']) : null,
			profile: token ? profile(saved['profile']) : null,
			unacceptedTerms:
				token && typeof saved['unacceptedTerms'] === 'string' ? saved['unacceptedTerms'] : null,
			acceptedUserId:
				token && typeof saved['acceptedUserId'] === 'string' ? saved['acceptedUserId'] : null,
			publishing: publishing(saved['publishing']),
			publishedThrough:
				typeof saved['publishedThrough'] === 'string' ? saved['publishedThrough'] : null,
			picked: Array.isArray(saved['picked'])
				? saved['picked'].filter((name): name is string => typeof name === 'string')
				: [],
			signIn: this.#pendingSignIn(saved['signIn']),
		};
	}

	canSeal(): boolean {
		return this.#cipher.isEncryptionAvailable();
	}

	save(profile: SavedProfile): Promise<void> {
		const { token, signIn } = profile;
		const text = JSON.stringify({
			...profile,
			token: token ? this.#seal(token) : '',
			signIn: signIn ? { ...signIn, verifier: this.#seal(signIn.verifier) } : null,
		});
		const temporary = `${this.#path}.tmp`;
		const previous = this.#writes;
		this.#writes = (async () => {
			await settled(previous);
			await writeFile(temporary, text, { mode: 0o600 });
			await rename(temporary, this.#path);
		})();
		return this.#writes;
	}

	#seal(text: string): string {
		return this.#cipher.encryptString(text).toString('base64');
	}

	#pendingSignIn(value: unknown): PendingSignIn | null {
		if (!isRecord(value)) return null;
		const { state, until } = value;
		const verifier = this.#unseal(value['verifier']);
		return verifier && typeof state === 'string' && typeof until === 'number'
			? { verifier, state, until }
			: null;
	}

	#unseal(sealed: unknown): string {
		if (typeof sealed !== 'string' || sealed.length === 0) return '';
		if (!this.#cipher.isEncryptionAvailable()) return '';
		try {
			return this.#cipher.decryptString(Buffer.from(sealed, 'base64'));
		} catch {
			return '';
		}
	}
}

export async function settled(work: Promise<unknown>): Promise<void> {
	try {
		await work;
	} catch {
		return;
	}
}

function account(value: unknown): BestboyAccount | null {
	if (!isRecord(value)) return null;
	const { name, email } = value;
	return typeof name === 'string' && typeof email === 'string' ? { name, email } : null;
}

function profile(value: unknown): BestboyProfile | null {
	if (!isRecord(value)) return null;
	const { handle, url } = value;
	return {
		handle: typeof handle === 'string' ? handle : null,
		public: value['public'] === true,
		url: typeof url === 'string' ? url : null,
	};
}

function publishing(value: unknown): StatsPublishing {
	return value === 'on' || value === 'removing' ? value : 'off';
}
