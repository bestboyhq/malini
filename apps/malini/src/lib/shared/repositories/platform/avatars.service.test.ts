import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	AVATAR_FRESH_MS,
	AVATAR_MISSING_MS,
	MAX_AVATAR_BYTES,
	avatarUrl,
	createAvatarStore,
	validateOwner,
	type AvatarFetcher,
} from './avatars.service';

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const DAY = 24 * 60 * 60 * 1000;

let root: string;
let clock: number;

function fakeFetcher(handler: (url: string) => Response | Promise<Response>): {
	fetcher: AvatarFetcher;
	calls: string[];
} {
	const calls: string[] = [];
	const fetcher: AvatarFetcher = async (url, init) => {
		expect(init.redirect).toBe('follow');
		expect(init.signal).toBeInstanceOf(AbortSignal);
		calls.push(url);
		return handler(url);
	};
	return { fetcher, calls };
}

function png(): Response {
	return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
}

function storeWith(handler: (url: string) => Response | Promise<Response>) {
	const { fetcher, calls } = fakeFetcher(handler);
	const store = createAvatarStore({ appDataRoot: root }, { fetcher, now: () => clock });
	return { store, calls };
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-avatars-'));
	clock = Date.parse('2026-09-19T12:00:00.000Z');
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('validateOwner', () => {
	it('accepts GitHub logins', () => {
		expect(validateOwner('octocat')).toBe('octocat');
		expect(validateOwner('acme-labs-1')).toBe('acme-labs-1');
		expect(validateOwner('a'.repeat(39))).toBe('a'.repeat(39));
	});

	it('rejects anything that cannot be a login', () => {
		for (const bad of ['', 'owner/name', 'octo cat', 'a'.repeat(40), 'octo_cat', 'octo.cat', 42]) {
			expect(() => validateOwner(bad)).toThrow(/invalid args/);
		}
	});
});

describe('createAvatarStore', () => {
	it('fetches the public avatar and sniffs the media type from the bytes', async () => {
		const { store, calls } = storeWith(() => png());
		const avatar = await store.get('octocat');
		expect(avatar).toEqual({ mediaType: 'image/png', base64: PNG.toString('base64') });
		expect(calls).toEqual([avatarUrl('octocat')]);
		expect(calls[0]).toBe('https://github.com/octocat.png?size=128');
		expect((await readdir(join(root, 'avatars'))).sort()).toEqual(['octocat.json', 'octocat.png']);
		const record = JSON.parse(await readFile(join(root, 'avatars', 'octocat.json'), 'utf8'));
		expect(record).toEqual({
			fetchedAt: new Date(clock).toISOString(),
			mediaType: 'image/png',
			file: 'octocat.png',
		});
	});

	it('does not trust the content-type header', async () => {
		const { store } = storeWith(
			() => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/png' } }),
		);
		expect(await store.get('octocat')).toEqual({
			mediaType: 'image/jpeg',
			base64: JPEG.toString('base64'),
		});
		expect((await readdir(join(root, 'avatars'))).sort()).toEqual(['octocat.jpg', 'octocat.json']);
	});

	it('throws for an invalid owner before touching the network', async () => {
		const { store, calls } = storeWith(() => png());
		await expect(store.get('owner/name')).rejects.toThrow(/invalid args/);
		await expect(store.get('')).rejects.toThrow(/invalid args/);
		await expect(store.get(undefined)).rejects.toThrow(/invalid args/);
		expect(calls).toEqual([]);
	});

	it('answers null for a 404 and remembers it for a day', async () => {
		const { store, calls } = storeWith(() => new Response('Not Found', { status: 404 }));
		expect(await store.get('not-a-login')).toBeNull();
		expect(await store.get('not-a-login')).toBeNull();
		expect(calls).toHaveLength(1);
		expect(await readdir(join(root, 'avatars'))).toEqual(['not-a-login.json']);

		clock += AVATAR_MISSING_MS - 1;
		expect(await store.get('not-a-login')).toBeNull();
		expect(calls).toHaveLength(1);

		clock += 2;
		expect(await store.get('not-a-login')).toBeNull();
		expect(calls).toHaveLength(2);
	});

	it('answers null for a body that is not an image', async () => {
		const { store } = storeWith(
			() =>
				new Response('<html>hello</html>', {
					status: 200,
					headers: { 'content-type': 'image/png' },
				}),
		);
		expect(await store.get('octocat')).toBeNull();
		expect(await readdir(join(root, 'avatars'))).toEqual(['octocat.json']);
	});

	it('answers null for a body over the size cap', async () => {
		const huge = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]);
		const { store } = storeWith(() => new Response(huge, { status: 200 }));
		expect(await store.get('octocat')).toBeNull();
	});

	it('answers null when the network is down and writes nothing', async () => {
		const { store } = storeWith(() => {
			throw new TypeError('fetch failed');
		});
		expect(await store.get('octocat')).toBeNull();
		await expect(readdir(join(root, 'avatars'))).rejects.toThrow();
	});

	it('serves a fresh cache without fetching, then refetches after seven days', async () => {
		const { store, calls } = storeWith(() => png());
		await store.get('octocat');
		clock += AVATAR_FRESH_MS - 1;
		expect(await store.get('octocat')).toEqual({
			mediaType: 'image/png',
			base64: PNG.toString('base64'),
		});
		expect(calls).toHaveLength(1);

		clock += 2;
		await store.get('octocat');
		expect(calls).toHaveLength(2);
	});

	it('treats the login as case-insensitive in the cache', async () => {
		const { store, calls } = storeWith(() => png());
		await store.get('OctoCat');
		await store.get('octocat');
		expect(calls).toHaveLength(1);
		expect((await readdir(join(root, 'avatars'))).sort()).toEqual(['octocat.json', 'octocat.png']);
	});

	it('serves the stale picture when the refetch fails', async () => {
		let online = true;
		const { store, calls } = storeWith(() => {
			if (!online) throw new TypeError('fetch failed');
			return png();
		});
		await store.get('octocat');
		clock += AVATAR_FRESH_MS + DAY;
		online = false;
		expect(await store.get('octocat')).toEqual({
			mediaType: 'image/png',
			base64: PNG.toString('base64'),
		});
		expect(calls).toHaveLength(2);
	});

	it('serves the stale picture on a 5xx, but honors a 404 on refetch', async () => {
		let status = 200;
		const { store } = storeWith(() => (status === 200 ? png() : new Response('', { status })));
		await store.get('octocat');
		clock += AVATAR_FRESH_MS + DAY;
		status = 503;
		expect(await store.get('octocat')).not.toBeNull();
		status = 404;
		expect(await store.get('octocat')).toBeNull();
		expect(await readdir(join(root, 'avatars'))).toEqual(['octocat.json']);
	});

	it('shares one fetch between concurrent requests for the same owner', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { store, calls } = storeWith(async () => {
			await gate;
			return png();
		});
		const first = store.get('octocat');
		const second = store.get('octocat');
		release();
		const [a, b] = await Promise.all([first, second]);
		expect(a).toEqual(b);
		expect(a?.mediaType).toBe('image/png');
		expect(calls).toHaveLength(1);
	});
});
