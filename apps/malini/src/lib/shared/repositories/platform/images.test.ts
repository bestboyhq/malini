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
		const image = await readWorkstreamImage(worktree, '.malini/agent-attachments/shot.png');
		expect(image).not.toBeNull();
		expect(image?.mediaType).toBe('image/png');
		expect(image?.size).toBe(PNG.length);
		expect(Buffer.from(image?.base64 ?? '', 'base64')).toEqual(PNG);
	});

	it('reads an image the model named by its absolute path in the worktree', async () => {
		await worktreeWith('.context/shot.png', PNG);
		expect(await readWorkstreamImage(worktree, join(worktree, '.context/shot.png'))).not.toBeNull();
	});

	it('tolerates a dot-slash prefix the model typed', async () => {
		await worktreeWith('shot.png', PNG);
		expect(await readWorkstreamImage(worktree, './shot.png')).not.toBeNull();
	});

	it('declines a file whose bytes are not an image', async () => {
		await worktreeWith('notes.png', 'plain text pretending');
		expect(await readWorkstreamImage(worktree, 'notes.png')).toBeNull();
	});

	it('declines a file past the preview cap', async () => {
		const oversized = Buffer.concat([PNG, Buffer.alloc(MAX_PREVIEW_BYTES + 1 - PNG.length)]);
		await worktreeWith('huge.png', oversized);
		expect(await readWorkstreamImage(worktree, 'huge.png')).toBeNull();
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

	it('rejects a missing file as a fault, not an answer', async () => {
		await worktreeWith('shot.png', PNG);
		await expect(readWorkstreamImage(worktree, 'gone.png')).rejects.toThrow(
			'open workstream image without following links',
		);
	});

	it.skipIf(!UNIX)('rejects a symlink out of the worktree', async () => {
		await worktreeWith('shot.png', PNG);
		const outside = join(temp, 'outside.png');
		await writeFile(outside, PNG);
		await symlink(outside, join(worktree, 'link.png'));
		await symlink(temp, join(worktree, 'escape'));

		await expect(readWorkstreamImage(worktree, 'link.png')).rejects.toThrow();
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
