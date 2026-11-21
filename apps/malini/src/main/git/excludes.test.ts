import { existsSync } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureStagingPrecondition } from './excludes';
import { initRealRepo, realGit, removeDir, tempDir } from './fixtures.test-support';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

async function checkout(): Promise<{ base: string; worktree: string }> {
	const root = await tempDir('malini-excludes-');
	cleanups.push(() => removeDir(root));
	const base = join(root, 'base');
	const worktree = join(root, 'worktree');
	await initRealRepo(base);
	await realGit(base, ['commit', '-q', '--allow-empty', '-m', 'start']);
	await realGit(base, ['worktree', 'add', '-q', worktree, '-b', 'malini/ws']);
	return { base, worktree };
}

describe('the exclude rule', () => {
	it('writes the rule when the repository has no info folder', async () => {
		const { base, worktree } = await checkout();
		await rm(join(base, '.git', 'info'), { recursive: true, force: true });

		await ensureStagingPrecondition(worktree);

		expect(await readFile(join(base, '.git', 'info', 'exclude'), 'utf8')).toContain('.context');
	});

	it('fails with the checkout error and leaves a vanished repository gone', async () => {
		const { base, worktree } = await checkout();
		await rename(base, `${base}-moved`);

		await expect(ensureStagingPrecondition(worktree)).rejects.toMatchObject({
			name: 'GitError',
		});
		expect(existsSync(base)).toBe(false);
	});
});
