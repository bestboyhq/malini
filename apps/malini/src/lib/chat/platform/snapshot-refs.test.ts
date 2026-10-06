import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { LEGACY_SNAPSHOT_REF_ROOTS } from '$main/git/snapshots';
import { adoptSnapshotRefNamespace, SnapshotRefNamespace } from './snapshot-refs';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('adoptSnapshotRefNamespace', () => {
	it('moves every legacy snapshot ref into refs/malini', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const head = (await realGit(repo, ['rev-parse', 'HEAD'])).trim();
		for (const ref of [
			'refs/smack/checkpoints/ws-1/cp-1',
			'refs/smack/run-changes/ws-1/rc-1',
			'refs/core/user-baselines/ws-1/ub-1',
			'refs/core/salvage/ws-1.undo.r-1',
		]) {
			await realGit(repo, ['update-ref', ref, head]);
		}

		await adoptSnapshotRefNamespace(repo);

		const listing = await realGit(repo, ['for-each-ref', '--format=%(refname)', 'refs/']);
		const refs = listing
			.split('\n')
			.map((line) => line.trim())
			.filter((line) =>
				[...LEGACY_SNAPSHOT_REF_ROOTS, 'refs/malini/'].some((root) => line.startsWith(root)),
			)
			.sort();
		expect(refs).toEqual([
			'refs/malini/checkpoints/ws-1/cp-1',
			'refs/malini/run-changes/ws-1/rc-1',
			'refs/malini/salvage/ws-1.undo.r-1',
			'refs/malini/user-baselines/ws-1/ub-1',
		]);
		expect((await realGit(repo, ['rev-parse', 'refs/malini/checkpoints/ws-1/cp-1'])).trim()).toBe(
			head,
		);
	});

	it('is a no-op on a checkout with no legacy refs', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);

		await expect(adoptSnapshotRefNamespace(repo)).resolves.toBeUndefined();
	});
});

describe('SnapshotRefNamespace', () => {
	it('adopts a worktree once and leaves later legacy refs alone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const head = (await realGit(repo, ['rev-parse', 'HEAD'])).trim();
		const namespace = new SnapshotRefNamespace();

		await namespace.adopt(repo);
		const lateRef = 'refs/smack/checkpoints/ws-1/cp-late';
		await realGit(repo, ['update-ref', lateRef, head]);
		await namespace.adopt(repo);

		expect((await realGit(repo, ['rev-parse', '--verify', lateRef])).trim()).toBe(head);
	});
});
