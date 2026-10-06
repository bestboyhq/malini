import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SECRET_STORE_FILE = 'renderer-secrets.json';

export const SECURE_STORAGE_UNAVAILABLE_ERROR = 'secure storage is not available on this system';

export interface SecretCipher {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

interface SecretStoreFile {
	version: 1;
	entries: Record<string, Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === 'object' && error !== null && 'code' in error;
}

function requireName(value: unknown, field: 'service' | 'key'): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`keychain ${field} must be a non-empty string`);
	}
	return value;
}

export class RendererSecretStore {
	private readonly path: string;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly appDataRoot: string,
		private readonly cipher: SecretCipher,
	) {
		this.path = join(appDataRoot, SECRET_STORE_FILE);
	}

	async get(service: unknown, key: unknown): Promise<string | null> {
		const [s, k] = this.validate(service, key);
		return this.serialized(async () => {
			const file = await this.read();
			const encoded = file.entries[s]?.[k];
			if (encoded === undefined) return null;
			try {
				return this.cipher.decryptString(Buffer.from(encoded, 'base64'));
			} catch (error) {
				throw new Error(`could not decrypt secret ${s}/${k}: ${describe(error)}`);
			}
		});
	}

	async set(service: unknown, key: unknown, value: unknown): Promise<void> {
		const [s, k] = this.validate(service, key);
		if (typeof value !== 'string') throw new Error('keychain value must be a string');
		return this.serialized(async () => {
			const file = await this.read();
			const bucket = (file.entries[s] ??= {});
			bucket[k] = this.cipher.encryptString(value).toString('base64');
			await this.write(file);
		});
	}

	async delete(service: unknown, key: unknown): Promise<void> {
		const [s, k] = this.validate(service, key);
		return this.serialized(async () => {
			const file = await this.read();
			const bucket = file.entries[s];
			if (!bucket || !(k in bucket)) return;
			delete bucket[k];
			if (Object.keys(bucket).length === 0) delete file.entries[s];
			await this.write(file);
		});
	}

	private validate(service: unknown, key: unknown): [string, string] {
		const s = requireName(service, 'service');
		const k = requireName(key, 'key');
		if (!this.cipher.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE_ERROR);
		return [s, k];
	}

	private async serialized<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.queue;
		let release = (): void => undefined;
		this.queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await previous;
			return await operation();
		} finally {
			release();
		}
	}

	private async read(): Promise<SecretStoreFile> {
		let raw: string;
		try {
			raw = await readFile(this.path, 'utf8');
		} catch (error) {
			if (isErrnoException(error) && error.code === 'ENOENT') return { version: 1, entries: {} };
			throw new Error(`could not read secret store ${this.path}: ${describe(error)}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`secret store ${this.path} is not valid JSON: ${describe(error)}`);
		}
		if (!isSecretStoreFile(parsed)) {
			throw new Error(`secret store ${this.path} has an unknown layout`);
		}
		return parsed;
	}

	private async write(file: SecretStoreFile): Promise<void> {
		await mkdir(this.appDataRoot, { recursive: true });
		const temporary = `${this.path}.tmp`;
		await writeFile(temporary, JSON.stringify(file), { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.path);
	}
}

function isSecretStoreFile(value: unknown): value is SecretStoreFile {
	if (!isRecord(value)) return false;
	if (value.version !== 1) return false;
	const entries = value.entries;
	if (!isRecord(entries)) return false;
	return Object.values(entries).every(
		(bucket) => isRecord(bucket) && Object.values(bucket).every((v) => typeof v === 'string'),
	);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
