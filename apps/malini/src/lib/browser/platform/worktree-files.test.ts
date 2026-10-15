import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worktreeFile } from './worktree-files';

vi.mock('electron', () => ({}));

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function worktreeBesideASecret(): { worktree: string; secret: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-worktree-files-')));
	roots.push(root);
	const worktree = join(root, 'worktree');
	mkdirSync(join(worktree, 'docs'), { recursive: true });
	writeFileSync(join(worktree, 'docs', 'report.html'), '<h1>Report</h1>');
	writeFileSync(join(worktree, 'docs', 'index.html'), '<h1>Docs</h1>');
	const secret = join(root, 'secret.txt');
	writeFileSync(secret, 'secret');
	symlinkSync(secret, join(worktree, 'leak.txt'));
	symlinkSync(root, join(worktree, 'up'));
	return { worktree, secret };
}

describe('worktreeFile', () => {
	it('serves a file of the worktree, and the index page of a folder', async () => {
		const { worktree } = worktreeBesideASecret();
		await expect(worktreeFile(worktree, '/docs/report.html')).resolves.toBe(
			join(worktree, 'docs', 'report.html'),
		);
		await expect(worktreeFile(worktree, '/docs/')).resolves.toBe(
			join(worktree, 'docs', 'index.html'),
		);
	});

	it('serves nothing outside the worktree, even through a link', async () => {
		const { worktree } = worktreeBesideASecret();
		for (const pathname of ['/../secret.txt', '/leak.txt', '/up/secret.txt', '/', '/nope.html']) {
			await expect(worktreeFile(worktree, pathname)).resolves.toBeNull();
		}
	});
});
