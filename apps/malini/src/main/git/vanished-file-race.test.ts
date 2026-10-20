import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffAll, workstreamChangeTotals, workstreamDiff, workstreamSnapshot } from './diff';
import { realGit, removeDir, tempDir, workstreamFixture } from './fixtures.test-support';
import { installGitRunnerForTests } from './run';
import { worktreeSnapshotTree } from './snapshots';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

type RaceFixture = Readonly<{
	checkout: string;
	vanishing: string;
	stagingCalls: () => number;
	attemptGaps: () => readonly number[];
	errors: () => readonly unknown[][];
}>;

async function checkoutWhereAFileVanishesMidRead(
	options: { vanishEveryTime?: boolean } = {},
): Promise<RaceFixture> {
	const dir = await tempDir();
	cleanups.push(() => removeDir(dir));
	const { checkout } = await workstreamFixture(dir, 'ws-race');
	const vanishing = join(checkout, 'vanishing.txt');
	await realGit(checkout, ['config', 'filter.vanish.clean', `sh -c 'rm -f "${vanishing}"; cat'`]);
	await writeFile(join(checkout, '.gitattributes'), 'agent.txt filter=vanish\n');
	await writeFile(join(checkout, 'agent.txt'), 'written by the agent\n');
	await writeFile(vanishing, 'undone while malini reads\n');
	let staging = 0;
	const attempts: number[] = [];
	const restore = installGitRunnerForTests(async (args, env, previous) => {
		if (args.includes('read-tree')) attempts.push(performance.now());
		if (args.includes('add') || args.includes('diff')) {
			staging += 1;
			if (options.vanishEveryTime && staging > 1) await writeFile(vanishing, 'back again\n');
		}
		return previous(args, env);
	});
	cleanups.push(async () => restore());
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	cleanups.push(async () => error.mockRestore());
	return {
		checkout,
		vanishing,
		stagingCalls: () => staging,
		attemptGaps: () => attempts.slice(1).map((at, index) => at - (attempts[index] ?? at)),
		errors: () => error.mock.calls,
	};
}

describe('a read that races a file deleted underneath it', () => {
	it('reads the workstream snapshot again instead of failing', async () => {
		const race = await checkoutWhereAFileVanishesMidRead();

		const snapshot = await workstreamSnapshot(race.checkout, 'main');

		expect(existsSync(race.vanishing)).toBe(false);
		expect(snapshot.patch).toContain('agent.txt');
		expect(snapshot.patch).not.toContain('vanishing.txt');
		expect(race.errors()).toEqual([]);
	});

	it('reads the change totals and the diff again instead of failing', async () => {
		const totals = await checkoutWhereAFileVanishesMidRead();
		expect(await workstreamChangeTotals(totals.checkout, 'main')).toEqual({
			additions: 2,
			deletions: 0,
			files: 2,
		});

		const diff = await checkoutWhereAFileVanishesMidRead();
		expect(await workstreamDiff(diff.checkout, 'main')).not.toContain('vanishing.txt');
	});

	it('diffs the worktree again when a file vanishes after it was listed', async () => {
		const race = await checkoutWhereAFileVanishesMidRead();

		const diff = await diffAll(race.checkout);

		expect(diff).toContain('agent.txt');
		expect(diff).not.toContain('vanishing.txt');
		expect(race.errors()).toEqual([]);
	});

	it('stages a checkpoint again when a file vanishes while it is staged', async () => {
		const race = await checkoutWhereAFileVanishesMidRead();

		const tree = await worktreeSnapshotTree(race.checkout);

		expect(await realGit(race.checkout, ['ls-tree', '--name-only', tree])).toContain('agent.txt');
	});

	it('gives a churning checkout longer to settle before each new read', async () => {
		const race = await checkoutWhereAFileVanishesMidRead({ vanishEveryTime: true });

		await expect(workstreamSnapshot(race.checkout, 'main')).rejects.toThrow(/unable to stat/u);

		const gaps = race.attemptGaps();
		expect(gaps).toHaveLength(2);
		expect(gaps[0]).toBeGreaterThanOrEqual(100);
		expect(gaps[1]).toBeGreaterThanOrEqual(200);
	});

	it('reports a real error when the file keeps vanishing', async () => {
		const race = await checkoutWhereAFileVanishesMidRead({ vanishEveryTime: true });

		await expect(workstreamSnapshot(race.checkout, 'main')).rejects.toThrow(
			/unable to stat 'vanishing\.txt': No such file or directory/u,
		);
		expect(race.stagingCalls()).toBe(3);
	});

	it('does not retry a failure that is not a vanished file', async () => {
		const race = await checkoutWhereAFileVanishesMidRead();
		const index = (
			await realGit(race.checkout, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
		).trim();
		await writeFile(index, 'x'.repeat(200));

		await expect(diffAll(race.checkout)).rejects.toThrow(/index file corrupt/u);
		expect(race.stagingCalls()).toBe(1);
		expect(await readFile(race.vanishing, 'utf8')).toBe('undone while malini reads\n');
	});
});

describe('a read that races its checkout being deleted', () => {
	it.each(['merge-base', 'read-tree', '--cached'])(
		'reports the checkout as a missing folder when its .git is gone by %s',
		async (step) => {
			const dir = await tempDir();
			cleanups.push(() => removeDir(dir));
			const { checkout } = await workstreamFixture(dir, 'ws-deleted');
			const restore = installGitRunnerForTests(async (args, env, previous) => {
				if (args.includes(step)) await rm(join(checkout, '.git'), { force: true });
				return previous(args, env);
			});
			cleanups.push(async () => restore());

			await expect(workstreamSnapshot(checkout, 'main')).rejects.toMatchObject({
				kind: 'io',
				code: 'ENOENT',
				message: 'The folder ws-deleted is missing.',
			});
		},
	);
});
