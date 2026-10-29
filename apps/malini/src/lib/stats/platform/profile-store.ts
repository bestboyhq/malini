import { readFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BestboyAccount, BestboyProfile, SharedParts, StatsPublishing } from '$contract/stats';
import { isRecord } from '$main/db/rows';
import { parseCatalog, type StatsCatalog } from '../domain/catalog-names';

export const PROFILE_FILE = 'bestboy-profile.json';
export const CATALOG_FILE = 'bestboy-catalog.json';

export type SavedCatalog = Readonly<{ fetchedOn: string; catalog: StatsCatalog }>;

export interface TokenCipher {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

export type SavedProfile = Readonly<{
	token: string;
	account: BestboyAccount | null;
	profile: BestboyProfile | null;
	publishing: StatsPublishing;
	publishedThrough: string | null;
	picked: readonly string[];
	sharedParts: SharedParts;
}>;

export const EVERY_PART: SharedParts = {
	techniques: true,
	tools: true,
	models: true,
	languages: true,
	mcpServers: true,
	skills: true,
};

export const SIGNED_OUT: SavedProfile = {
	token: '',
	account: null,
	profile: null,
	publishing: 'off',
	publishedThrough: null,
	picked: [],
	sharedParts: EVERY_PART,
};

export class ProfileStore {
	readonly #path: string;
	readonly #cipher: TokenCipher;
	#writes: Promise<void> = Promise.resolve();

	readonly #catalogPath: string;

	constructor(appDataRoot: string, cipher: TokenCipher) {
		this.#path = join(appDataRoot, PROFILE_FILE);
		this.#catalogPath = join(appDataRoot, CATALOG_FILE);
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
			publishing: publishing(saved['publishing']),
			publishedThrough:
				typeof saved['publishedThrough'] === 'string' ? saved['publishedThrough'] : null,
			picked: Array.isArray(saved['picked'])
				? saved['picked'].filter((name): name is string => typeof name === 'string')
				: [],
			sharedParts: sharedParts(saved['sharedParts']),
		};
	}

	async loadCatalog(): Promise<SavedCatalog | null> {
		try {
			const saved: unknown = JSON.parse(await readFile(this.#catalogPath, 'utf8'));
			if (!isRecord(saved) || typeof saved['fetchedOn'] !== 'string') return null;
			const catalog = parseCatalog(saved['catalog']);
			return catalog ? { fetchedOn: saved['fetchedOn'], catalog } : null;
		} catch {
			return null;
		}
	}

	saveCatalog(saved: SavedCatalog): Promise<void> {
		return this.#write(this.#catalogPath, JSON.stringify(saved));
	}

	canSeal(): boolean {
		return this.#cipher.isEncryptionAvailable();
	}

	save(profile: SavedProfile): Promise<void> {
		const sealed = profile.token
			? this.#cipher.encryptString(profile.token).toString('base64')
			: '';
		return this.#write(this.#path, JSON.stringify({ ...profile, token: sealed }));
	}

	#write(path: string, text: string): Promise<void> {
		const temporary = `${path}.tmp`;
		const previous = this.#writes;
		this.#writes = (async () => {
			await settled(previous);
			await writeFile(temporary, text, { mode: 0o600 });
			await rename(temporary, path);
		})();
		return this.#writes;
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

function sharedParts(value: unknown): SharedParts {
	if (!isRecord(value)) return EVERY_PART;
	return {
		techniques: value['techniques'] !== false,
		tools: value['tools'] !== false,
		models: value['models'] !== false,
		languages: value['languages'] !== false,
		mcpServers: value['mcpServers'] !== false,
		skills: value['skills'] !== false,
	};
}

function publishing(value: unknown): StatsPublishing {
	return value === 'on' || value === 'removing' ? value : 'off';
}
