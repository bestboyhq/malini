import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MainContext } from '$main/context';
import { imageMediaType } from './images';
import type { OwnerAvatar } from '$contract/repositories';

export type { OwnerAvatar };

export type AvatarFetcher = (
	url: string,
	init: { signal: AbortSignal; redirect: 'follow' },
) => Promise<Response>;

export interface AvatarStoreOptions {
	fetcher?: AvatarFetcher;
	now?: () => number;
}

export interface AvatarStore {
	get(owner: unknown): Promise<OwnerAvatar | null>;
}

export const AVATAR_SIZE = 128;
export const MAX_AVATAR_BYTES = 1024 * 1024;
export const AVATAR_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const AVATAR_MISSING_MS = 24 * 60 * 60 * 1000;
export const AVATAR_FETCH_TIMEOUT_MS = 10_000;

const AVATARS_DIR_NAME = 'avatars';
const IMAGE_HEADER_BYTES = 16;
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
};

export function validateOwner(owner: unknown): string {
	if (typeof owner !== 'string' || owner.length === 0) {
		throw new Error('invalid args: `owner` must be a non-empty string');
	}
	if (owner.length > 39 || !/^[A-Za-z0-9-]+$/.test(owner)) {
		throw new Error(`invalid args: \`owner\` is not a GitHub login: \`${owner}\``);
	}
	return owner;
}

export function avatarUrl(owner: string): string {
	return `https://github.com/${owner}.png?size=${AVATAR_SIZE}`;
}

interface AvatarRecord {
	fetchedAt: string;
	mediaType: string | null;
	file: string | null;
}

type FetchOutcome =
	{ kind: 'image'; mediaType: string; bytes: Buffer } | { kind: 'missing' } | { kind: 'failed' };

export function createAvatarStore(
	context: Pick<MainContext, 'appDataRoot'>,
	options: AvatarStoreOptions = {},
): AvatarStore {
	const fetcher: AvatarFetcher = options.fetcher ?? ((url, init) => fetch(url, init));
	const now = options.now ?? Date.now;
	const directory = join(context.appDataRoot, AVATARS_DIR_NAME);
	const inFlight = new Map<string, Promise<OwnerAvatar | null>>();

	const keyOf = (owner: string): string => owner.toLowerCase();
	const recordPath = (key: string): string => join(directory, `${key}.json`);

	const readRecord = async (key: string): Promise<AvatarRecord | null> => {
		let raw: string;
		try {
			raw = await readFile(recordPath(key), 'utf8');
		} catch {
			return null;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!isRecord(parsed) || typeof parsed.fetchedAt !== 'string') return null;
			return {
				fetchedAt: parsed.fetchedAt,
				mediaType: typeof parsed.mediaType === 'string' ? parsed.mediaType : null,
				file: typeof parsed.file === 'string' ? parsed.file : null,
			};
		} catch {
			return null;
		}
	};

	const readCached = async (record: AvatarRecord): Promise<OwnerAvatar | null> => {
		if (record.file === null || record.mediaType === null) return null;
		try {
			const bytes = await readFile(join(directory, record.file));
			return { mediaType: record.mediaType, base64: bytes.toString('base64') };
		} catch {
			return null;
		}
	};

	const ageOf = (record: AvatarRecord): number => {
		const fetchedAt = Date.parse(record.fetchedAt);
		return Number.isFinite(fetchedAt) ? now() - fetchedAt : Number.POSITIVE_INFINITY;
	};

	const store = async (
		key: string,
		previous: AvatarRecord | null,
		outcome: Exclude<FetchOutcome, { kind: 'failed' }>,
	): Promise<void> => {
		await mkdir(directory, { recursive: true });
		let file: string | null = null;
		let mediaType: string | null = null;
		if (outcome.kind === 'image') {
			file = `${key}.${EXTENSION_BY_MEDIA_TYPE[outcome.mediaType] ?? 'bin'}`;
			mediaType = outcome.mediaType;
			await writeFile(join(directory, file), outcome.bytes);
		}
		if (previous?.file && previous.file !== file) {
			await rm(join(directory, previous.file), { force: true });
		}
		const record: AvatarRecord = { fetchedAt: new Date(now()).toISOString(), mediaType, file };
		await writeFile(recordPath(key), JSON.stringify(record));
	};

	const resolve = async (owner: string): Promise<OwnerAvatar | null> => {
		const key = keyOf(owner);
		const record = await readRecord(key);
		if (record) {
			const age = ageOf(record);
			if (record.file === null) {
				if (age < AVATAR_MISSING_MS) return null;
			} else if (age < AVATAR_FRESH_MS) {
				const cached = await readCached(record);
				if (cached) return cached;
			}
		}

		const outcome = await fetchAvatar(fetcher, owner);
		if (outcome.kind === 'failed') {
			return record ? readCached(record) : null;
		}
		try {
			await store(key, record, outcome);
		} catch {}
		return outcome.kind === 'image'
			? { mediaType: outcome.mediaType, base64: outcome.bytes.toString('base64') }
			: null;
	};

	return {
		async get(raw) {
			const owner = validateOwner(raw);
			const key = keyOf(owner);
			const pending = inFlight.get(key);
			if (pending) return pending;
			const promise = resolve(owner).finally(() => inFlight.delete(key));
			inFlight.set(key, promise);
			return promise;
		},
	};
}

async function fetchAvatar(fetcher: AvatarFetcher, owner: string): Promise<FetchOutcome> {
	let response: Response;
	try {
		response = await fetcher(avatarUrl(owner), {
			signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
			redirect: 'follow',
		});
	} catch {
		return { kind: 'failed' };
	}
	if (response.status === 404) return { kind: 'missing' };
	if (!response.ok) return { kind: 'failed' };

	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES) return { kind: 'missing' };

	let bytes: Buffer;
	try {
		bytes = await readBounded(response, MAX_AVATAR_BYTES);
	} catch (error) {
		return error instanceof TooLargeError ? { kind: 'missing' } : { kind: 'failed' };
	}
	const mediaType = imageMediaType(bytes.subarray(0, Math.min(bytes.length, IMAGE_HEADER_BYTES)));
	if (mediaType === null) return { kind: 'missing' };
	return { kind: 'image', mediaType, bytes };
}

class TooLargeError extends Error {}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
	if (!response.body) return Buffer.alloc(0);
	const chunks: Buffer[] = [];
	let total = 0;
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				throw new TooLargeError('avatar body exceeds the size cap');
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
