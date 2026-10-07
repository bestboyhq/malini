import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	writeAttachmentFixture,
} from './fixtures.test-support';
import {
	checkoutHasUncommittedWork,
	composeSessionRunSnapshots,
	createCheckpointSnapshot,
	createRunChangeSnapshot,
	createUserBaselineSnapshot,
	deleteCheckpointRef,
	deleteRunChangeRef,
	deleteUserBaselineRef,
	diffComposedSessionSnapshotPatch,
	diffWorktreeSnapshotPatch,
	diffWorktreeSnapshots,
	restoreCheckpointSnapshot,
	snapshotCommitTree,
	undoSalvageRefName,
	worktreeSnapshotTree,
} from './snapshots';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('private snapshots', () => {
	it('a checkpoint captures every kind of dirt and restores it without moving HEAD', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const head = (await realGit(repo, ['rev-parse', 'HEAD'])).trim();
		await writeFile(join(repo, 'seed.txt'), 'seed\nedited\n');
		await writeFile(join(repo, 'new.txt'), 'new\n');
		await writeAttachmentFixture(repo);

		expect(await checkoutHasUncommittedWork(repo)).toBe(true);
		const commit = await createCheckpointSnapshot(repo, 'refs/malini/checkpoints/cp-1', 'cp-1');
		expect((await realGit(repo, ['rev-parse', 'refs/malini/checkpoints/cp-1'])).trim()).toBe(
			commit,
		);
		expect((await realGit(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		expect((await realGit(repo, ['log', '-1', '--format=%s %an', commit])).trim()).toBe(
			'malini checkpoint cp-1 malini checkpoint',
		);
		const files = (await realGit(repo, ['ls-tree', '-r', '--name-only', commit])).split('\n');
		expect(files).toContain('new.txt');
		expect(files).not.toContain('.malini/agent-attachments/att-test/payload.txt');

		await writeFile(join(repo, 'seed.txt'), 'seed\nlater\n');
		await rm(join(repo, 'new.txt'));
		await writeFile(join(repo, 'stray.txt'), 'stray\n');
		await restoreCheckpointSnapshot(repo, commit);
		expect(await readFile(join(repo, 'seed.txt'), 'utf8')).toBe('seed\nedited\n');
		expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('new\n');
		expect(existsSync(join(repo, 'stray.txt'))).toBe(false);
		expect((await realGit(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		expect((await realGit(repo, ['diff', '--cached', '--name-only'])).trim()).toBe('');

		await deleteCheckpointRef(repo, 'refs/malini/checkpoints/cp-1');
		await expect(
			realGit(repo, ['rev-parse', '--verify', 'refs/malini/checkpoints/cp-1']),
		).rejects.toThrow();
	});

	it('a user baseline is authored as itself and every helper refuses a foreign namespace', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'human.txt'), 'human\n');
		const commit = await createUserBaselineSnapshot(repo, 'refs/malini/user-baselines/b-1', 'b-1');
		expect((await realGit(repo, ['log', '-1', '--format=%an <%ae>', commit])).trim()).toBe(
			'malini user baseline <user-baseline@malini.local>',
		);

		await expect(createCheckpointSnapshot(repo, 'refs/heads/main', 'x')).rejects.toThrow(
			'unsafe path: snapshot ref `refs/heads/main` is outside the private `refs/malini/checkpoints/` namespace',
		);
		await expect(createRunChangeSnapshot(repo, 'refs/malini/checkpoints/x', 'x')).rejects.toThrow(
			/outside the private `refs\/malini\/run-changes\/` namespace/,
		);
		await expect(
			createUserBaselineSnapshot(repo, 'refs/malini/user-baselines/a b', 'x'),
		).rejects.toThrow(/outside the private/);
		await expect(deleteRunChangeRef(repo, 'refs/malini/checkpoints/x')).rejects.toThrow(/outside/);
		await expect(deleteUserBaselineRef(repo, 'refs/malini/run-changes/x')).rejects.toThrow(
			/outside/,
		);
		expect(undoSalvageRefName('ws-1', 'r-1')).toBe('refs/malini/salvage/ws-1.undo.r-1');
	});

	it('the tree probe answers whether anything touched the checkout', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'agent.txt'), 'agent\n');
		const after = await createRunChangeSnapshot(repo, 'refs/malini/run-changes/r-1', 'r-1');
		expect(await worktreeSnapshotTree(repo)).toBe(await snapshotCommitTree(repo, after));
		await writeFile(join(repo, 'human.txt'), 'human\n');
		expect(await worktreeSnapshotTree(repo)).not.toBe(await snapshotCommitTree(repo, after));
	});

	it('diffs two snapshots as an inventory and as a bounded patch', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const before = await createCheckpointSnapshot(repo, 'refs/malini/checkpoints/cp-1', 'cp-1');
		await writeFile(join(repo, 'seed.txt'), 'seed\nmore\n');
		await writeFile(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 255]));
		const after = await createRunChangeSnapshot(repo, 'refs/malini/run-changes/r-1', 'r-1');

		expect(await diffWorktreeSnapshots(repo, before, after)).toEqual({
			files: [
				{ path: 'bin.dat', additions: 0, deletions: 0, isBinary: true },
				{ path: 'seed.txt', additions: 1, deletions: 0, isBinary: false },
			],
		});
		const patch = await diffWorktreeSnapshotPatch(repo, before, after, 'seed.txt');
		expect(patch).toContain('+more');
		expect(patch).not.toContain('bin.dat');
		expect(await diffWorktreeSnapshotPatch(repo, before, after, null)).toContain('bin.dat');
		await expect(diffWorktreeSnapshotPatch(repo, before, after, '../x')).rejects.toThrow(
			/must be a repository-relative file/,
		);
		await expect(diffWorktreeSnapshots(repo, 'nope', after)).rejects.toMatchObject({ kind: 'git' });
	});

	it('composes run intervals and stacks a file whose outside edit cannot be separated', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const r1Before = await createCheckpointSnapshot(repo, 'refs/malini/checkpoints/cp-1', 'cp-1');
		await writeFile(join(repo, 'seed.txt'), 'seed\nrun one\n');
		const r1After = await createRunChangeSnapshot(repo, 'refs/malini/run-changes/r-1', 'r-1');
		await writeFile(join(repo, 'seed.txt'), 'completely\ndifferent\n');
		const r2Before = await createCheckpointSnapshot(repo, 'refs/malini/checkpoints/cp-2', 'cp-2');
		await writeFile(join(repo, 'seed.txt'), 'completely\ndifferent\nrun two\n');
		await writeFile(join(repo, 'other.txt'), 'other\n');
		const r2After = await createRunChangeSnapshot(repo, 'refs/malini/run-changes/r-2', 'r-2');

		const composed = await composeSessionRunSnapshots(repo, [
			{
				runId: 'r-1',
				beforeCommit: r1Before,
				afterCommit: r1After,
				files: (await diffWorktreeSnapshots(repo, r1Before, r1After)).files,
			},
			{
				runId: 'r-2',
				beforeCommit: r2Before,
				afterCommit: r2After,
				files: (await diffWorktreeSnapshots(repo, r2Before, r2After)).files,
			},
		]);
		expect([...composed.runIdsByPath.entries()]).toEqual([
			['other.txt', ['r-2']],
			['seed.txt', ['r-1', 'r-2']],
		]);
		expect([...composed.stackedPaths]).toEqual(['seed.txt']);
		expect(composed.files).toEqual([
			{ path: 'other.txt', additions: 1, deletions: 0, isBinary: false },
		]);
		expect(
			await diffComposedSessionSnapshotPatch(
				repo,
				composed.beforeTree,
				composed.afterTree,
				'other.txt',
			),
		).toContain('+other');
	});

	it(
		'composes thousands of files a run re-adds after they vanished between runs',
		{ timeout: 90_000 },
		async () => {
			const dir = await tempDir();
			cleanups.push(() => removeDir(dir));
			const repo = join(dir, 'repo');
			await initRealRepo(repo);
			const store = join(repo, 'store');
			const files = Array.from({ length: 2_000 }, (_, index) => `file-${index}.txt`);
			const runs = [];
			for (const runId of ['r-1', 'r-2', 'r-3']) {
				const beforeCommit = await createCheckpointSnapshot(
					repo,
					`refs/malini/checkpoints/${runId}`,
					runId,
				);
				await mkdir(store, { recursive: true });
				for (const file of files) await writeFile(join(store, file), `${file}\n`);
				const afterCommit = await createRunChangeSnapshot(
					repo,
					`refs/malini/run-changes/${runId}`,
					runId,
				);
				runs.push({
					runId,
					beforeCommit,
					afterCommit,
					files: (await diffWorktreeSnapshots(repo, beforeCommit, afterCommit)).files,
				});
				await rm(store, { recursive: true });
			}

			const composed = await composeSessionRunSnapshots(repo, runs);
			expect(composed.stackedPaths.size).toBe(0);
			expect(composed.files).toHaveLength(2_000);
			expect(composed.runIdsByPath.get('store/file-0.txt')).toEqual(['r-1', 'r-2', 'r-3']);
		},
	);

	it('captures a checkpoint in a repository that has no commit yet', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await mkdir(repo, { recursive: true });
		await realGit(repo, ['init', '-q']);
		await writeFile(join(repo, 'first.txt'), 'first\n');

		const commit = await createCheckpointSnapshot(repo, 'refs/malini/checkpoints/cp-1', 'cp-1');
		expect((await realGit(repo, ['ls-tree', '-r', '--name-only', commit])).trim()).toBe(
			'first.txt',
		);
		expect((await realGit(repo, ['log', '-1', '--format=%P', commit])).trim()).toBe('');
		expect(await worktreeSnapshotTree(repo)).toBe(await snapshotCommitTree(repo, commit));
	});
});
