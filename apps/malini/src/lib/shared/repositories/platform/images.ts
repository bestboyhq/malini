import { constants as fsConstants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join, relative } from 'node:path';
import { describeError, isErrnoException } from '$main/errors';
import { isAtOrInsideDirectory } from '$main/fs/paths';
import type { WorkstreamImageRead } from '$contract/repositories';

export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

const IMAGE_HEADER_BYTES = 16;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];
const STREAM_CHUNK_BYTES = 256 * 1024;
const MISSING: WorkstreamImageRead = { status: 'missing' };

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

export function videoMediaType(header: Uint8Array): string | null {
	const ascii = Buffer.from(header).toString('latin1');
	if (ascii.slice(4, 8) === 'ftyp') {
		return ascii.slice(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
	}
	if (WEBM_SIGNATURE.every((byte, index) => header[index] === byte)) return 'video/webm';
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

function isMissingPath(error: unknown): boolean {
	return isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

async function openNoFollow(path: string): Promise<FileHandle | null> {
	let flags = fsConstants.O_RDONLY;
	if (process.platform !== 'win32') flags |= fsConstants.O_NOFOLLOW;
	try {
		return await open(path, flags);
	} catch (error) {
		if (isMissingPath(error)) return null;
		throw new Error(`open workstream image without following links: ${describeError(error)}`);
	}
}

export async function readWorkstreamImage(
	worktree: string,
	path: string,
	agentHasRead: (path: string) => boolean = () => false,
): Promise<WorkstreamImageRead> {
	const file = await workstreamFile(worktree, path, agentHasRead);
	return file === null ? MISSING : readImageFile(file);
}

export async function workstreamFile(
	worktree: string,
	path: string,
	agentHasRead: (path: string) => boolean = () => false,
): Promise<string | null> {
	if (isAbsolute(path) && !isAtOrInsideDirectory(worktree, path) && agentHasRead(path)) {
		return path;
	}
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
		if (isMissingPath(error)) return null;
		throw new Error(`canonicalize image directory: ${describeError(error)}`);
	}
	if (!isAtOrInsideDirectory(root, parent)) throw new Error('image path escapes the workstream');
	const name = basename(target);
	if (name.length === 0) throw new Error('image path must name a file');
	return join(parent, name);
}

async function readImageFile(path: string): Promise<WorkstreamImageRead> {
	const file = await openNoFollow(path);
	if (file === null) return MISSING;
	try {
		return await readOpenImage(file, await fileSize(file));
	} finally {
		await file.close();
	}
}

async function fileSize(file: FileHandle): Promise<number> {
	let metadata;
	try {
		metadata = await file.stat();
	} catch (error) {
		throw new Error(`inspect workstream image: ${describeError(error)}`);
	}
	if (!metadata.isFile()) throw new Error('image path is not a file');
	return metadata.size;
}

async function readOpenImage(file: FileHandle, size: number): Promise<WorkstreamImageRead> {
	if (size > MAX_PREVIEW_BYTES) return { status: 'too-large' };
	const buffer = new Uint8Array(size);
	let filled = 0;
	while (filled < buffer.length) {
		let read: number;
		try {
			({ bytesRead: read } = await file.read(buffer, filled, buffer.length - filled, filled));
		} catch (error) {
			throw new Error(`read workstream image: ${describeError(error)}`);
		}
		if (read === 0) break;
		filled += read;
	}
	const data = buffer.subarray(0, filled);
	const mediaType = imageMediaType(data.subarray(0, IMAGE_HEADER_BYTES));
	if (mediaType === null) return { status: 'not-an-image' };
	return { status: 'ready', bytes: { mediaType, data } };
}

export type ByteRange = Readonly<{ start: number; end: number }>;

export function requestedRange(header: string | null, size: number): ByteRange | 'whole' | null {
	const match = header === null ? null : /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
	if (!match || (match[1] === '' && match[2] === '')) return 'whole';
	const [, from = '', to = ''] = match;
	if (from === '') {
		const suffix = Number(to);
		return suffix === 0 || size === 0 ? null : { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(from);
	const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
	return start >= size || start > end ? null : { start, end };
}

export async function workstreamMediaResponse(
	path: string,
	range: string | null,
): Promise<Response> {
	const file = await openNoFollow(path);
	if (file === null) return new Response('missing', { status: 404 });
	let streaming = false;
	try {
		const size = await fileSize(file);
		const header = new Uint8Array(IMAGE_HEADER_BYTES);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		const video = videoMediaType(header.subarray(0, bytesRead));
		if (video === null) {
			const image = await readOpenImage(file, size);
			if (image.status !== 'ready') return new Response(image.status, { status: 404 });
			return new Response(image.bytes.data, {
				headers: {
					'content-type': image.bytes.mediaType,
					'x-content-type-options': 'nosniff',
					'access-control-allow-origin': '*',
				},
			});
		}
		const span = requestedRange(range, size);
		if (span === null) {
			return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
		}
		const { start, end } = span === 'whole' ? { start: 0, end: size - 1 } : span;
		streaming = true;
		return new Response(fileStream(file, start, end), {
			status: span === 'whole' ? 200 : 206,
			headers: {
				'content-type': video,
				'content-length': String(end - start + 1),
				'accept-ranges': 'bytes',
				'x-content-type-options': 'nosniff',
				...(span === 'whole' ? {} : { 'content-range': `bytes ${start}-${end}/${size}` }),
			},
		});
	} finally {
		if (!streaming) await file.close();
	}
}

function fileStream(file: FileHandle, start: number, end: number): ReadableStream<Uint8Array> {
	let position = start;
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		await file.close();
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const chunk = new Uint8Array(Math.max(0, Math.min(STREAM_CHUNK_BYTES, end - position + 1)));
			try {
				const { bytesRead } =
					chunk.length > 0 ? await file.read(chunk, 0, chunk.length, position) : { bytesRead: 0 };
				if (bytesRead === 0) {
					controller.close();
					await close();
					return;
				}
				controller.enqueue(chunk.subarray(0, bytesRead));
				position += bytesRead;
			} catch (error) {
				controller.error(error);
				await close();
			}
		},
		cancel: close,
	});
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
