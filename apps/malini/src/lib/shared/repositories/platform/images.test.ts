import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import {
	MAX_PREVIEW_BYTES,
	imageMediaType,
	readWorkstreamImage,
	safeRelativePath,
	parseWorkstreamId,
	requestedRange,
	videoMediaType,
	workstreamMediaResponse,
} from './images';

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const UNIX = process.platform !== 'win32';

let temp: string;
let worktree: string;

async function worktreeWith(name: string, bytes: Buffer | string): Promise<void> {
	await mkdir(join(worktree, '.malini/agent-attachments'), { recursive: true });
	await mkdir(join(worktree, name, '..'), { recursive: true });
	await writeFile(join(worktree, name), bytes);
}

beforeEach(async () => {
	temp = await mkdtemp(join(tmpdir(), 'malini-images-'));
	worktree = join(temp, 'worktree');
});

afterEach(async () => {
	await rm(temp, { recursive: true, force: true });
});

describe('readWorkstreamImage', () => {
	it('reads an image nested in the worktree', async () => {
		await worktreeWith('.malini/agent-attachments/shot.png', PNG);
		const read = await readWorkstreamImage(worktree, '.malini/agent-attachments/shot.png');
		const image = read.status === 'ready' ? read.bytes : null;
		expect(image?.mediaType).toBe('image/png');
		expect(Buffer.from(image?.data ?? [])).toEqual(PNG);
	});

	it('reads an image as large as the biggest attachment', async () => {
		const pasted = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length)]);
		await worktreeWith('.malini/agent-attachments/pasted-image-0.png', pasted);
		const read = await readWorkstreamImage(
			worktree,
			'.malini/agent-attachments/pasted-image-0.png',
		);
		expect(read.status === 'ready' && pasted.equals(read.bytes.data)).toBe(true);
	});

	it('reads an image the model named by its absolute path in the worktree', async () => {
		await worktreeWith('.context/shot.png', PNG);
		expect(await readWorkstreamImage(worktree, join(worktree, '.context/shot.png'))).toMatchObject({
			status: 'ready',
		});
	});

	it('tolerates a dot-slash prefix the model typed', async () => {
		await worktreeWith('shot.png', PNG);
		expect(await readWorkstreamImage(worktree, './shot.png')).toMatchObject({ status: 'ready' });
	});

	it('declines a file whose bytes are not an image', async () => {
		await worktreeWith('notes.png', 'plain text pretending');
		expect(await readWorkstreamImage(worktree, 'notes.png')).toEqual({ status: 'not-an-image' });
	});

	it('declines a file past the preview cap', async () => {
		const oversized = Buffer.concat([PNG, Buffer.alloc(MAX_PREVIEW_BYTES + 1 - PNG.length)]);
		await worktreeWith('huge.png', oversized);
		expect(await readWorkstreamImage(worktree, 'huge.png')).toEqual({ status: 'too-large' });
	});

	it('rejects paths that leave the worktree before any filesystem call', async () => {
		await worktreeWith('shot.png', PNG);
		for (const path of [
			'../outside.png',
			'/etc/hosts',
			'a/../../outside.png',
			'',
			join(temp, 'outside.png'),
			join(worktree, '../outside.png'),
		]) {
			await expect(readWorkstreamImage(worktree, path)).rejects.toThrow(/image path/);
		}
		expect(() => safeRelativePath('')).toThrow('image path must be relative to the workstream');
		expect(() => safeRelativePath('/x')).toThrow('image path must be relative to the workstream');
		expect(() => safeRelativePath('a/../b')).toThrow('image path escapes the workstream');
		expect(() => safeRelativePath('./.')).toThrow('image path must name a file');
		expect(safeRelativePath('./a//b/./c.png')).toBe('a/b/c.png');
	});

	it('reads an image outside the worktree only when the agent read that path', async () => {
		const outside = join(temp, 'outside.png');
		await writeFile(outside, PNG);
		await worktreeWith('shot.png', PNG);
		const readByAgent = (path: string) => path === outside;

		expect(await readWorkstreamImage(worktree, outside, readByAgent)).toMatchObject({
			status: 'ready',
		});
		expect(await readWorkstreamImage(worktree, join(temp, 'gone.png'), () => true)).toEqual({
			status: 'missing',
		});
		await expect(readWorkstreamImage(worktree, outside)).rejects.toThrow(
			'image path escapes the workstream',
		);
		await expect(readWorkstreamImage(worktree, '../outside.png', () => true)).rejects.toThrow(
			'image path escapes the workstream',
		);
	});

	it('answers missing for an image whose file or folder is gone', async () => {
		await worktreeWith('shot.png', PNG);
		expect(await readWorkstreamImage(worktree, 'gone.png')).toEqual({ status: 'missing' });
		expect(await readWorkstreamImage(worktree, '.context/review/gone.png')).toEqual({
			status: 'missing',
		});
		expect(await readWorkstreamImage(worktree, 'shot.png/gone.png')).toEqual({ status: 'missing' });
	});

	it.skipIf(!UNIX)('rejects a symlink out of the worktree', async () => {
		await worktreeWith('shot.png', PNG);
		const outside = join(temp, 'outside.png');
		await writeFile(outside, PNG);
		await symlink(outside, join(worktree, 'link.png'));
		await symlink(temp, join(worktree, 'escape'));

		await expect(readWorkstreamImage(worktree, 'link.png')).rejects.toThrow();
		await expect(
			readWorkstreamImage(worktree, join(worktree, 'link.png'), () => true),
		).rejects.toThrow();
		await expect(readWorkstreamImage(worktree, 'escape/outside.png')).rejects.toThrow(
			'image path escapes the workstream',
		);
	});
});

describe('imageMediaType', () => {
	it('recognizes png, jpeg, gif and webp by signature only', () => {
		expect(imageMediaType(PNG)).toBe('image/png');
		expect(imageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(imageMediaType(Buffer.from('GIF89a......'))).toBe('image/gif');
		expect(imageMediaType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
		expect(imageMediaType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
		expect(imageMediaType(Buffer.from('<svg'))).toBeNull();
		expect(imageMediaType(Buffer.alloc(0))).toBeNull();
	});
});

describe('videoMediaType', () => {
	it('recognizes mp4, quicktime and webm containers by signature only', () => {
		expect(videoMediaType(Buffer.from('\0\0\0\x20ftypisom'))).toBe('video/mp4');
		expect(videoMediaType(Buffer.from('\0\0\0\x14ftypqt  '))).toBe('video/quicktime');
		expect(videoMediaType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toBe('video/webm');
		expect(videoMediaType(PNG)).toBeNull();
		expect(videoMediaType(Buffer.alloc(0))).toBeNull();
	});
});

describe('requestedRange', () => {
	it('reads one byte range the way a video element asks for it', () => {
		expect(requestedRange(null, 100)).toBe('whole');
		expect(requestedRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
		expect(requestedRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
		expect(requestedRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
		expect(requestedRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
		expect(requestedRange('bytes=100-', 100)).toBeNull();
		expect(requestedRange('bytes=0-1,5-6', 100)).toBe('whole');
	});
});

describe('workstreamMediaResponse', () => {
	const MP4 = Buffer.concat([Buffer.from('\0\0\0\x20ftypisom'), Buffer.alloc(1000, 7)]);

	it('streams the byte range a video element asks for', async () => {
		await worktreeWith('clip.mp4', MP4);
		const partial = await workstreamMediaResponse(join(worktree, 'clip.mp4'), 'bytes=4-11');
		expect(partial.status).toBe(206);
		expect(partial.headers.get('content-type')).toBe('video/mp4');
		expect(partial.headers.get('content-range')).toBe(`bytes 4-11/${MP4.length}`);
		expect(Buffer.from(await partial.arrayBuffer()).toString('latin1')).toBe('ftypisom');

		const whole = await workstreamMediaResponse(join(worktree, 'clip.mp4'), null);
		expect(whole.status).toBe(200);
		expect(whole.headers.get('accept-ranges')).toBe('bytes');
		expect(Buffer.from(await whole.arrayBuffer()).equals(MP4)).toBe(true);

		const beyond = await workstreamMediaResponse(join(worktree, 'clip.mp4'), 'bytes=5000-');
		expect(beyond.status).toBe(416);
	});

	it('serves an image whole and refuses what is neither', async () => {
		await worktreeWith('shot.png', PNG);
		await worktreeWith('notes.txt', 'hello');
		const image = await workstreamMediaResponse(join(worktree, 'shot.png'), 'bytes=0-3');
		expect(image.status).toBe(200);
		expect(image.headers.get('content-type')).toBe('image/png');
		expect((await workstreamMediaResponse(join(worktree, 'notes.txt'), null)).status).toBe(404);
		expect((await workstreamMediaResponse(join(worktree, 'gone.mp4'), null)).status).toBe(404);
	});
});

describe('parseWorkstreamId', () => {
	it('accepts the branch-safe alphabet and names the offending character', () => {
		expect(parseWorkstreamId('ws-1_A')).toBe('ws-1_A');
		expect(() => parseWorkstreamId('')).toThrow('unsafe path: empty workstream id');
		expect(() => parseWorkstreamId(undefined)).toThrow('unsafe path: empty workstream id');
		expect(() => parseWorkstreamId('a/b')).toThrow(
			'unsafe path: workstream id contains unsafe char `/`: `a/b`',
		);
	});
});
