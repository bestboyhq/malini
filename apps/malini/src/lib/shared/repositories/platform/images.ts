import { constants as fsConstants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join, relative } from 'node:path';
import { describeError } from '$main/errors';
import { isAtOrInsideDirectory } from '$main/fs/paths';
import type { WorkstreamImageBytes } from '$contract/repositories';

export type { WorkstreamImageBytes };

export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

const IMAGE_HEADER_BYTES = 16;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function imageMediaType(header: Uint8Array): string | null {
	if (header.length >= 8 && PNG_SIGNATURE.every((byte, index) => header[index] === byte)) {
		return 'image/png';
	}
	if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
		return 'image/jpeg';
	}
	const ascii = Buffer.from(header).toString('latin1');
	if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
	if (header.length >= 12 && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
		return 'image/webp';
	}
	return null;
}

export function safeRelativePath(path: string): string {
	if (path.length === 0 || isAbsolute(path)) {
		throw new Error('image path must be relative to the workstream');
	}
	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') throw new Error('image path escapes the workstream');
		segments.push(segment);
	}
	if (segments.length === 0) throw new Error('image path must name a file');
	return segments.join('/');
}

async function openNoFollow(path: string): Promise<FileHandle> {
	let flags = fsConstants.O_RDONLY;
	if (process.platform !== 'win32') flags |= fsConstants.O_NOFOLLOW;
	try {
		return await open(path, flags);
	} catch (error) {
		throw new Error(`open workstream image without following links: ${describeError(error)}`);
	}
}

export async function readWorkstreamImage(
	worktree: string,
	path: string,
): Promise<WorkstreamImageBytes | null> {
	const inside = safeRelativePath(isAbsolute(path) ? relative(worktree, path) : path);
	let root: string;
	try {
		root = await realpath(worktree);
	} catch (error) {
		throw new Error(`canonicalize worktree: ${describeError(error)}`);
	}
	const target = join(root, inside);

	let parent: string;
	try {
		parent = await realpath(dirname(target));
	} catch (error) {
		throw new Error(`canonicalize image directory: ${describeError(error)}`);
	}
	if (!isAtOrInsideDirectory(root, parent)) throw new Error('image path escapes the workstream');
	const name = basename(target);
	if (name.length === 0) throw new Error('image path must name a file');

	const file = await openNoFollow(join(parent, name));
	try {
		let metadata;
		try {
			metadata = await file.stat();
		} catch (error) {
			throw new Error(`inspect workstream image: ${describeError(error)}`);
		}
		if (!metadata.isFile()) throw new Error('image path is not a file');
		if (metadata.size > MAX_PREVIEW_BYTES) return null;

		const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
		let filled = 0;
		for (;;) {
			let read: number;
			try {
				({ bytesRead: read } = await file.read(buffer, filled, buffer.length - filled, null));
			} catch (error) {
				throw new Error(`read workstream image: ${describeError(error)}`);
			}
			if (read === 0) break;
			filled += read;
			if (filled >= buffer.length) break;
		}
		if (filled > MAX_PREVIEW_BYTES) return null;

		const bytes = buffer.subarray(0, filled);
		const mediaType = imageMediaType(bytes.subarray(0, Math.min(filled, IMAGE_HEADER_BYTES)));
		if (mediaType === null) return null;
		return { mediaType, size: filled, base64: bytes.toString('base64') };
	} finally {
		await file.close();
	}
}

export function parseWorkstreamId(workstreamId: unknown): string {
	if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
		throw new Error('unsafe path: empty workstream id');
	}
	for (const character of workstreamId) {
		if (!/^[A-Za-z0-9_-]$/.test(character)) {
			throw new Error(
				`unsafe path: workstream id contains unsafe char \`${character}\`: \`${workstreamId}\``,
			);
		}
	}
	return workstreamId;
}
