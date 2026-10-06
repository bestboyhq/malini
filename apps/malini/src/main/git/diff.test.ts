import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	diffAll,
	diffCollector,
	listWorkstreamFiles,
	parseNumstatTotals,
	parseSnapshotNumstat,
	resolveBaseCommit,
	workstreamChangeTotals,
	workstreamDiff,
	workstreamSnapshot,
} from './diff';
import { repositoryExcludeWithManagedRule } from './excludes';
import {
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	writeAttachmentFixture,
	writeSandboxScratchFixture,
} from './fixtures.test-support';
import { AGENT_ATTACHMENTS_PATH, LEGACY_APP_MANAGED_REPOSITORY_EXCLUDES } from './paths';
import { installGitRunnerForTests } from './run';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

function unifiedDiffLineTotals(diff: string): {
	additions: number;
	deletions: number;
	files: number;
} {
	const totals = { additions: 0, deletions: 0, files: 0 };
	for (const line of diff.split('\n')) {
		if (line.startsWith('diff --git ')) totals.files += 1;
		if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
		if (line.startsWith('+')) totals.additions += 1;
		else if (line.startsWith('-')) totals.deletions += 1;
	}
	return totals;
}

describe('parseNumstatTotals', () => {
	it('t13e is strict and ignores binary line counts', () => {
		expect(
			parseNumstatTotals('12\t3\tsrc/app.ts\n-\t-\tassets/logo.png\n4\t0\tpath with spaces.md\n'),
		).toEqual({ additions: 16, deletions: 3, files: 3 });
		expect(() => parseNumstatTotals('not-a-count\t2\tbroken.ts\n')).toThrow(
			'invalid git numstat additions in row',
		);
		expect(() => parseNumstatTotals('1\tmissing-path\n')).toThrow(
			'invalid git numstat row without a path',
		);
		expect(parseNumstatTotals('\n  \n')).toEqual({ additions: 0, deletions: 0, files: 0 });
	});
});

describe('parseSnapshotNumstat', () => {
	it('sorts, flags binaries, and refuses duplicates and half-binary rows', () => {
		expect(parseSnapshotNumstat('3\t1\tz.ts\0-\t-\timg.png\0')).toEqual([
			{ path: 'img.png', additions: 0, deletions: 0, isBinary: true },
			{ path: 'z.ts', additions: 3, deletions: 1, isBinary: false },
		]);
		expect(() => parseSnapshotNumstat('1\t1\ta\0' + '1\t1\ta\0')).toThrow(/duplicate path/);
		expect(() => parseSnapshotNumstat('-\t1\ta\0')).toThrow(/inconsistent binary counts/);
		expect(() => parseSnapshotNumstat('1\t1\0')).toThrow(/without a path/);
	});
});

describe('repositoryExcludeWithManagedRule', () => {
	it('t0a preserves unrelated lines, dedupes managed rules, and is idempotent', () => {
		const existing = [
			'# comment',
			'/build/',
			...LEGACY_APP_MANAGED_REPOSITORY_EXCLUDES,
			'/.malini/agent-attachments/',
			'node_modules',
			'',
		].join('\r\n');
		const once = repositoryExcludeWithManagedRule(existing);
		expect(once).toBe(
			'# comment\r\n/build/\r\nnode_modules\r\n/.malini/agent-attachments/\n/.malini/sandbox/\n',
		);
		expect(repositoryExcludeWithManagedRule(once)).toBe(once);
		expect(repositoryExcludeWithManagedRule('')).toBe(
			'/.malini/agent-attachments/\n/.malini/sandbox/\n',
		);
	});
});

describe('diffCollector', () => {
	it('t11 rejects a dotdot path and hides a managed path', async () => {
		await expect(diffCollector('/tmp', '../x')).rejects.toThrow(
			'unsafe path: diff path `../x` rejected by delete-guard',
		);
		await expect(diffCollector('/tmp', '/abs')).rejects.toThrow(/rejected by delete-guard/);
		expect(await diffCollector('/tmp', `${AGENT_ATTACHMENTS_PATH}/x`)).toBe('');
	});
});

describe('diffAll', () => {
	it('refuses a diff too large to hand to the window instead of reading it all', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'vendored.txt'), `${'x'.repeat(1023)}\n`.repeat(33 * 1024));

		await expect(diffAll(repo)).rejects.toMatchObject({ kind: 'output-too-large' });
	});

	it('t15 installs the ignore rule, copies the real index, then runs a private add -N and diff', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const wt = join(dir, 'wt');
		await initRealRepo(wt);
		const realIndex = join(wt, '.git', 'index');
		const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
		const restore = installGitRunnerForTests(async (args, env) => {
			calls.push({ args: [...args], env: { ...env } });
			if (args.includes('info/exclude')) return `${join(wt, '.git', 'info', 'exclude')}\n`;
			if (args.includes('--git-path')) return `${realIndex}\n`;
			return '';
		});
		cleanups.push(async () => restore());

		await diffAll(wt);

		expect(calls).toHaveLength(4);
		expect(calls[0]?.args).toContain('info/exclude');
		expect(calls[1]?.args).toEqual(expect.arrayContaining(['rev-parse', '--git-path']));
		expect(calls[1]?.env).toEqual({});
		const privateIndex = calls[2]?.env.GIT_INDEX_FILE;
		expect(privateIndex).toBeDefined();
		expect(privateIndex).not.toBe(realIndex);
		expect(calls[3]?.env).toEqual({ GIT_INDEX_FILE: privateIndex });
		await expect(readFile(privateIndex ?? '')).rejects.toThrow();
		expect(calls[2]?.args.slice(0, 2)).toEqual(['-C', wt]);
		expect(calls[2]?.args).toEqual(expect.arrayContaining(['add', '-N', '.']));
		expect(calls[2]?.args).not.toContain(':(exclude,top).malini/agent-attachments');
		expect(calls[3]?.args).toEqual(
			expect.arrayContaining([
				'diff',
				'--no-color',
				'--no-ext-diff',
				'--src-prefix=a/',
				'--dst-prefix=b/',
				':(exclude,top).malini/agent-attachments',
				':(exclude,top).malini/agent-attachments/**',
			]),
		);
		expect(calls[3]?.args).not.toContain('add');
	});

	it('t16 surfaces a new untracked file as an addition without touching the real index', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'seed.txt'), 'seed\nstaged\n');
		await realGit(repo, ['add', 'seed.txt']);
		await writeFile(join(repo, 'seed.txt'), 'seed\nstaged\nworking\n');
		await writeFile(join(repo, 'health.ts'), 'export const health = () => true;\n');

		const reported = (await realGit(repo, ['rev-parse', '--git-path', 'index'])).trim();
		const realIndex = isAbsolute(reported) ? reported : join(repo, reported);
		const treeBefore = await realGit(repo, ['write-tree']);
		const indexBefore = await readFile(realIndex);

		const diff = await diffAll(repo);

		expect(diff).toContain('health.ts');
		expect(diff).toContain('+export const health');
		expect(diff).toContain('+working');
		expect(diff, 'legacy semantics compare the worktree with staged content').not.toContain(
			'+staged',
		);
		expect(await realGit(repo, ['write-tree'])).toBe(treeBefore);
		expect(await readFile(realIndex)).toEqual(indexBefore);
	});

	it('t17 hides managed agent attachments', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeAttachmentFixture(repo);
		await writeFile(join(repo, 'visible.txt'), 'visible diff\n');
		const diff = await diffAll(repo);
		expect(diff).toContain('visible.txt');
		expect(diff).toContain('+visible diff');
		expect(diff).not.toContain('agent-attachments');
		expect(diff).not.toContain('private transport bytes');
	});
});

describe('workstream snapshot', () => {
	async function workstreamAgainstMain(dir: string): Promise<string> {
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await realGit(repo, ['branch', '-M', 'main']);
		await realGit(repo, ['checkout', '-q', '-b', 'malini/ws-1']);
		await writeFile(join(repo, 'committed.txt'), 'one\ntwo\n');
		await realGit(repo, ['add', '.']);
		await realGit(repo, ['commit', '-q', '-m', 'committed']);
		await writeFile(join(repo, 'seed.txt'), 'seed\nstaged\n');
		await realGit(repo, ['add', 'seed.txt']);
		await writeFile(join(repo, 'seed.txt'), 'seed\nstaged\nunstaged\n');
		await writeFile(join(repo, 'untracked.txt'), 'u\n');
		await rm(join(repo, 'committed.txt'));
		await writeAttachmentFixture(repo);
		await writeSandboxScratchFixture(repo);
		return repo;
	}

	it('t17a totals and diff share one complete non-mutating snapshot', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = await workstreamAgainstMain(dir);
		const treeBefore = await realGit(repo, ['write-tree']);
		const statusBefore = await realGit(repo, [
			'status',
			'--porcelain',
			'--',
			'.',
			':(exclude,top).malini',
		]);

		const totals = await workstreamChangeTotals(repo, 'main');
		const diff = await workstreamDiff(repo, 'main');
		const snapshot = await workstreamSnapshot(repo, 'main');

		expect(totals).toEqual({ additions: 3, deletions: 0, files: 2 });
		expect(unifiedDiffLineTotals(diff)).toEqual(totals);
		expect(snapshot).toEqual({ patch: diff, totals });
		expect(diff).toContain('+unstaged');
		expect(diff).toContain('+staged');
		expect(diff).toContain('untracked.txt');
		expect(diff).not.toContain('committed.txt');
		expect(diff).not.toContain('agent-attachments');
		expect(diff).not.toContain('sandbox');
		expect(await realGit(repo, ['write-tree'])).toBe(treeBefore);
		expect(await realGit(repo, ['status', '--porcelain', '--', '.', ':(exclude,top).malini'])).toBe(
			statusBefore,
		);
	});

	it('resolves the base through origin first, then a local branch, and refuses a bad name', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = await workstreamAgainstMain(dir);
		const main = (await realGit(repo, ['rev-parse', 'main'])).trim();
		expect(await resolveBaseCommit(repo, 'main')).toBe(main);
		expect(await resolveBaseCommit(repo, 'refs/heads/main')).toBe(main);
		await expect(resolveBaseCommit(repo, 'nope')).rejects.toMatchObject({ kind: 'git' });
		await expect(resolveBaseCommit(repo, 'a..b')).rejects.toThrow('invalid base branch');
	});
});

describe('a huge untracked tree', () => {
	async function workstreamWithPackageStore(dir: string): Promise<string> {
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await realGit(repo, ['branch', '-M', 'main']);
		await realGit(repo, ['checkout', '-q', '-b', 'malini/ws-1']);
		const store = join(repo, '.pnpm-store', 'v11', 'files');
		await mkdir(store, { recursive: true });
		const contents = `${'x'.repeat(1023)}\n`.repeat(18);
		await Promise.all(
			Array.from({ length: 2000 }, (_, index) =>
				writeFile(join(store, `${index}-${'0'.repeat(100)}`), contents),
			),
		);
		await writeFile(join(repo, 'seed.txt'), 'seed\nedited\n');
		await writeFile(join(repo, 'fresh.ts'), 'export const fresh = true;\n');
		await mkdir(join(repo, 'src', 'feature'), { recursive: true });
		await writeFile(join(repo, 'src', 'feature', 'index.ts'), 'export const feature = 1;\n');
		return repo;
	}

	it('collapses only the junk tree, keeping a new source directory beside it', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = await workstreamWithPackageStore(dir);

		const uncommitted = await diffAll(repo);
		const snapshot = await workstreamSnapshot(repo, 'main');

		for (const patch of [uncommitted, snapshot.patch]) {
			expect(patch).toContain('+edited');
			expect(patch).toContain('+export const fresh = true;');
			expect(patch).toContain('+export const feature = 1;');
			expect(patch).not.toContain('.pnpm-store');
		}
		expect(snapshot.totals).toEqual({ additions: 3, deletions: 0, files: 4 });
	}, 30_000);

	it('still shows every file of a small new directory', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await mkdir(join(repo, 'src', 'feature'), { recursive: true });
		await writeFile(join(repo, 'src', 'feature', 'index.ts'), 'export const feature = 1;\n');

		expect(await diffAll(repo)).toContain('+export const feature = 1;');
	});
});

describe('listWorkstreamFiles', () => {
	it('t13c returns sorted tracked and untracked paths, transport files excluded', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'README.md'), 'r\n');
		await writeFile(join(repo, 'z.ts'), 'z\n');
		await writeAttachmentFixture(repo);
		await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
		await writeFile(join(repo, 'ignored.txt'), 'x\n');
		expect(await listWorkstreamFiles(repo)).toEqual([
			{ path: '.gitignore' },
			{ path: 'README.md' },
			{ path: 'seed.txt' },
			{ path: 'z.ts' },
		]);
	});
});
