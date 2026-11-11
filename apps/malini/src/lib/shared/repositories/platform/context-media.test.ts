import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listContextMedia } from './context-media';

let temp: string;
let worktree: string;

async function write(path: string, text: string, modifiedAt?: string): Promise<void> {
	const file = join(worktree, path);
	await mkdir(join(file, '..'), { recursive: true });
	await writeFile(file, text);
	if (modifiedAt) await utimes(file, new Date(modifiedAt), new Date(modifiedAt));
}

beforeEach(async () => {
	temp = await mkdtemp(join(tmpdir(), 'malini-context-media-'));
	worktree = join(temp, 'worktree');
	await mkdir(worktree);
});

afterEach(async () => {
	await rm(temp, { recursive: true, force: true });
});

it('lists the media files under .context, newest first, with their category, size and time', async () => {
	await write('.context/shot.png', 'png', '2026-01-01T00:00:00.000Z');
	await write('.context/review/clip.webm', 'webm!', '2026-03-01T00:00:00.000Z');
	await write('.context/review/deep/voice.mp3', 'mp3', '2026-02-01T00:00:00.000Z');
	await write('.context/proto.html', '<p>', '2026-01-01T00:00:00.000Z');
	await write('.context/notes.md', '# notes', '2025-12-01T00:00:00.000Z');
	await write('.context/run.log', 'not media');
	await write('shot.png', 'outside .context');
	await mkdir(join(worktree, '.context/folder.png'));

	expect(await listContextMedia(worktree)).toEqual([
		{
			path: '.context/review/clip.webm',
			size: 5,
			modifiedAt: '2026-03-01T00:00:00.000Z',
			category: 'videos',
		},
		{
			path: '.context/review/deep/voice.mp3',
			size: 3,
			modifiedAt: '2026-02-01T00:00:00.000Z',
			category: 'audio',
		},
		{
			path: '.context/proto.html',
			size: 3,
			modifiedAt: '2026-01-01T00:00:00.000Z',
			category: 'pages',
		},
		{
			path: '.context/shot.png',
			size: 3,
			modifiedAt: '2026-01-01T00:00:00.000Z',
			category: 'images',
		},
		{
			path: '.context/notes.md',
			size: 7,
			modifiedAt: '2025-12-01T00:00:00.000Z',
			category: 'documents',
		},
	]);
});

it('never follows a link, to a file or a folder, in or out of the worktree', async () => {
	await write('.context/real.png', 'png');
	await mkdir(join(temp, 'outside'));
	await writeFile(join(temp, 'outside/secret.png'), 'secret');
	await symlink(join(temp, 'outside/secret.png'), join(worktree, '.context/linked.png'));
	await symlink(join(temp, 'outside'), join(worktree, '.context/linked-folder'));
	await symlink(join(worktree, '.context/real.png'), join(worktree, '.context/again.png'));

	expect((await listContextMedia(worktree)).map(({ path }) => path)).toEqual(['.context/real.png']);
});

it('lists nothing when .context is missing, a file, or a link out of the worktree', async () => {
	expect(await listContextMedia(worktree)).toEqual([]);

	await writeFile(join(worktree, '.context'), 'not a folder');
	expect(await listContextMedia(worktree)).toEqual([]);

	await rm(join(worktree, '.context'));
	await mkdir(join(temp, 'elsewhere'));
	await writeFile(join(temp, 'elsewhere/shot.png'), 'png');
	await symlink(join(temp, 'elsewhere'), join(worktree, '.context'));
	expect(await listContextMedia(worktree)).toEqual([]);
});
