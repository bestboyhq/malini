import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RendererSecretStore,
	SECRET_STORE_FILE,
	SECURE_STORAGE_UNAVAILABLE_ERROR,
} from './secrets';
import { createFakeCipher } from './test-support';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-secrets-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('RendererSecretStore', () => {
	it('round-trips a secret through the cipher and answers null for a missing one', async () => {
		const store = new RendererSecretStore(root, createFakeCipher());
		expect(await store.get('malini.desktop.auth', 'session')).toBeNull();
		await store.set('malini.desktop.auth', 'session', 'hunter2');
		expect(await store.get('malini.desktop.auth', 'session')).toBe('hunter2');
		await store.delete('malini.desktop.auth', 'session');
		expect(await store.get('malini.desktop.auth', 'session')).toBeNull();
	});

	it('never writes the plaintext to disk and keeps the file private', async () => {
		const store = new RendererSecretStore(root, createFakeCipher());
		await store.set('malini.desktop.auth', 'session', 'plain-secret-value');
		const path = join(root, SECRET_STORE_FILE);
		const raw = await readFile(path, 'utf8');
		expect(raw).not.toContain('plain-secret-value');
		expect(JSON.parse(raw)).toMatchObject({ version: 1 });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it('persists across store instances and scopes keys by service', async () => {
		const cipher = createFakeCipher();
		const first = new RendererSecretStore(root, cipher);
		await first.set('a.service', 'key', 'one');
		await first.set('b.service', 'key', 'two');

		const second = new RendererSecretStore(root, cipher);
		expect(await second.get('a.service', 'key')).toBe('one');
		expect(await second.get('b.service', 'key')).toBe('two');
		await second.delete('a.service', 'key');
		expect(await second.get('a.service', 'key')).toBeNull();
		expect(await second.get('b.service', 'key')).toBe('two');
	});

	it('deleting a secret that does not exist is not an error', async () => {
		const store = new RendererSecretStore(root, createFakeCipher());
		await expect(store.delete('a.service', 'never-set')).resolves.toBeUndefined();
	});

	it('serializes concurrent writes so none is lost', async () => {
		const store = new RendererSecretStore(root, createFakeCipher());
		await Promise.all(
			Array.from({ length: 12 }, (_, index) => store.set('svc', `key-${index}`, `value-${index}`)),
		);
		for (let index = 0; index < 12; index += 1) {
			expect(await store.get('svc', `key-${index}`)).toBe(`value-${index}`);
		}
	});

	it('rejects empty or non-string names and non-string values', async () => {
		const store = new RendererSecretStore(root, createFakeCipher());
		await expect(store.get('', 'key')).rejects.toThrow(
			'keychain service must be a non-empty string',
		);
		await expect(store.get('svc', undefined)).rejects.toThrow(
			'keychain key must be a non-empty string',
		);
		await expect(store.set('svc', 'key', 42)).rejects.toThrow('keychain value must be a string');
	});

	it('fails closed when the OS cannot encrypt', async () => {
		const cipher = createFakeCipher();
		cipher.available = false;
		const store = new RendererSecretStore(root, cipher);
		await expect(store.set('svc', 'key', 'x')).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE_ERROR);
		await expect(store.get('svc', 'key')).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE_ERROR);
	});

	it('names a ciphertext it cannot decrypt instead of returning garbage', async () => {
		const writer = new RendererSecretStore(root, createFakeCipher());
		await writer.set('svc', 'key', 'value');
		const broken = createFakeCipher();
		broken.decryptString = () => {
			throw new Error('wrong key');
		};
		const reader = new RendererSecretStore(root, broken);
		await expect(reader.get('svc', 'key')).rejects.toThrow(
			'could not decrypt secret svc/key: wrong key',
		);
	});
});
