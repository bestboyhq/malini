import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';

import { listBaseFiles } from './base-files.service';

const created: string[] = [];

afterEach(async () => {
	for (const directory of created.splice(0)) await removeDir(directory);
});

describe('listBaseFiles', () => {
	it('lists the files a new checkout of the fetched base would show, and nothing else', async () => {
		const repo = await tempDir('malini-base-files-');
		created.push(repo);
		await initRealRepo(repo);
		await mkdir(join(repo, 'src/nested'), { recursive: true });
		await mkdir(join(repo, 'build'), { recursive: true });
		await writeFile(join(repo, 'src/nested/deep.ts'), 'export const deep = true;\n');
		await writeFile(join(repo, 'build/icon.png'), 'png');
		await realGit(repo, ['add', '.']);
		await realGit(repo, ['commit', '-m', 'base']);
		await realGit(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
		await writeFile(join(repo, 'src/after-fetch.ts'), 'export const later = true;\n');
		await realGit(repo, ['add', '.']);
		await realGit(repo, ['commit', '-m', 'local only']);
		await writeFile(join(repo, 'untracked.ts'), 'export const loose = true;\n');

		const files = await listBaseFiles(repo, 'main');

		expect(files).toContain('src/nested/deep.ts');
		expect(files).not.toContain('build/icon.png');
		expect(files).not.toContain('src/after-fetch.ts');
		expect(files).not.toContain('untracked.ts');
		expect(files).toEqual([...files].sort());
	});

	it('knows nothing about a base that was never fetched', async () => {
		const repo = await tempDir('malini-base-files-');
		created.push(repo);
		await initRealRepo(repo);

		expect(await listBaseFiles(repo, 'main')).toEqual([]);
	});
});
