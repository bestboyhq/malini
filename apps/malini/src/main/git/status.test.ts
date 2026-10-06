import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '$shared/repositories/domain/diff';
import { diffAll, listWorkstreamFiles } from './diff';
import {
	initConflictingBranches,
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	tryRealGit,
	writeAttachmentFixture,
	writeSandboxScratchFixture,
} from './fixtures.test-support';
import { parseStatus, statusCollector } from './status';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('parseStatus', () => {
	it('t13 parses branch, ahead/behind, and dirty paths', () => {
		const status = parseStatus(
			porcelain(
				'## main...origin/main [ahead 3, behind 1]',
				' M src/lib.rs',
				'?? untracked.txt',
				'A  new_file.rs',
			),
		);
		expect(status).toEqual({
			branch: 'main',
			ahead: 3,
			behind: 1,
			headSha: null,
			dirtyPaths: ['src/lib.rs', 'untracked.txt', 'new_file.rs'],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
		});
	});

	it('t13p marks every unmerged porcelain code conflicted and keeps it dirty', () => {
		for (const code of ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']) {
			const status = parseStatus(porcelain('## main...origin/main', `${code} conflicted.txt`));
			expect(status.conflictedPaths, code).toEqual(['conflicted.txt']);
			expect(status.dirtyPaths, code).toEqual(['conflicted.txt']);
		}
	});

	it('t13q leaves ordinary changes unconflicted', () => {
		const status = parseStatus(
			porcelain(
				'## main...origin/main',
				' M modified.txt',
				'?? untracked.txt',
				'A  added.txt',
				' D deleted.txt',
				'MM staged-and-modified.txt',
				'R  renamed.txt',
				'original.txt',
			),
		);
		expect(status.conflictedPaths).toEqual([]);
		expect(status.dirtyPaths).toHaveLength(6);
	});

	it('reports a rename or copy once, under the path it now has', () => {
		const status = parseStatus(
			porcelain(
				'## main',
				'R  moved.txt',
				'a.txt',
				'C  copy.txt',
				'b.txt',
				'RM edited.txt',
				'c.txt',
			),
		);
		expect(status.dirtyPaths).toEqual(['moved.txt', 'copy.txt', 'edited.txt']);
	});

	it('t13r reports a branch that tracks nothing', () => {
		const neverPushed = parseStatus(porcelain('## malini/ws-1', ' M src/lib.rs'));
		expect(neverPushed.branch).toBe('malini/ws-1');
		expect(neverPushed.hasUpstream).toBe(false);
		expect([neverPushed.ahead, neverPushed.behind]).toEqual([0, 0]);

		const level = parseStatus(porcelain('## malini/ws-1...origin/malini/ws-1'));
		expect(level.hasUpstream).toBe(true);
		expect([level.ahead, level.behind]).toEqual([0, 0]);
	});

	it('t13s reports a clean tree', () => {
		const status = parseStatus(porcelain('## main...origin/main'));
		expect(status.dirtyPaths).toEqual([]);
		expect(status.conflictedPaths).toEqual([]);
		expect(status.mergeInProgress).toBe(false);
		expect(status.hasUpstream).toBe(true);
	});

	it('hides app-managed paths from the raw porcelain', () => {
		const status = parseStatus(
			porcelain(
				'## main',
				'?? .malini/agent-attachments/att-1/log.txt',
				'?? .malini/sandbox/scratch.txt',
				' M a.txt',
			),
		);
		expect(status.dirtyPaths).toEqual(['a.txt']);
	});
});

function porcelain(...records: string[]): string {
	return records.map((record) => `${record}\0`).join('');
}

describe('statusCollector', () => {
	it('reads a real checkout: branch, head sha, dirty paths, no upstream', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeFile(join(repo, 'seed.txt'), 'seed\nmore\n');
		await writeFile(join(repo, 'new.txt'), 'new\n');
		const status = await statusCollector(repo);
		expect(status.branch).toMatch(/^(main|master)$/);
		expect(status.headSha).toMatch(/^[0-9a-f]{40}$/);
		expect(status.dirtyPaths).toEqual(['seed.txt', 'new.txt']);
		expect(status.hasUpstream).toBe(false);
		expect(status.mergeInProgress).toBe(false);
	});

	it('reports one change per file, and an untracked tree too large to read as one directory', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await mkdir(join(repo, 'notes'));
		await writeFile(join(repo, 'notes', 'scratch.txt'), 'hello\n');
		await writeFile(join(repo, 'notes', 'todo.txt'), 'todo\n');
		await mkdir(join(repo, 'src', 'feature'), { recursive: true });
		await writeFile(join(repo, 'src', 'feature', 'index.ts'), 'export const feature = 1;\n');
		await writeFile(join(repo, 'café notes.md'), 'accent\n');
		await realGit(repo, ['mv', 'seed.txt', 'moved.txt']);
		const junk = join(repo, 'build-output', 'chunks');
		await mkdir(junk, { recursive: true });
		await Promise.all(
			Array.from({ length: 1_200 }, (_, index) =>
				writeFile(join(junk, `${index}-${'0'.repeat(120)}.js`), 'x\n'),
			),
		);

		const status = await statusCollector(repo);
		const listed = (await listWorkstreamFiles(repo)).map(({ path }) => path);
		const diffed = parseUnifiedDiff(await diffAll(repo)).map(
			({ newPath, oldPath }) => newPath ?? oldPath,
		);

		expect([...status.dirtyPaths].sort()).toEqual([
			'build-output/',
			'café notes.md',
			'moved.txt',
			'notes/scratch.txt',
			'notes/todo.txt',
			'src/feature/index.ts',
		]);
		for (const entry of status.dirtyPaths) {
			expect(
				listed.some((path) => path === entry || path.startsWith(entry)),
				entry,
			).toBe(true);
		}
		expect(listed.filter((path) => path.startsWith('build-output/'))).toHaveLength(1_200);
		expect(status.dirtyPaths).toEqual(expect.arrayContaining(diffed));
	}, 30_000);

	it('t13d hides managed agent attachments and sandbox scratch', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeAttachmentFixture(repo);
		await writeSandboxScratchFixture(repo);
		await writeFile(join(repo, 'visible.txt'), 'visible\n');
		const status = await statusCollector(repo);
		expect(status.dirtyPaths).toEqual(['visible.txt']);
	});

	it('t13t sees a real conflicted merge and its abort', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initConflictingBranches(repo);
		expect((await statusCollector(repo)).mergeInProgress).toBe(false);
		expect(await tryRealGit(repo, ['merge', 'theirs'])).toBe(false);

		const status = await statusCollector(repo);
		expect(status.mergeInProgress).toBe(true);
		expect(status.conflictedPaths).toEqual(['shared.txt']);
		expect(status.conflictMarkerPaths).toEqual(['shared.txt']);
		expect(status.dirtyPaths).toContain('shared.txt');

		await writeFile(join(repo, 'shared.txt'), 'ours\ntheirs\n');
		const edited = await statusCollector(repo);
		expect(edited.conflictedPaths).toEqual(['shared.txt']);
		expect(edited.conflictMarkerPaths).toEqual([]);
		expect(edited.mergeInProgress).toBe(true);

		await realGit(repo, ['merge', '--abort']);
		const settled = await statusCollector(repo);
		expect(settled.mergeInProgress).toBe(false);
		expect(settled.conflictedPaths).toEqual([]);
	});

	it('t13u sees a real conflicted rebase and names the branch it is rebasing', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		const trunk = await initConflictingBranches(repo);
		expect(await tryRealGit(repo, ['rebase', 'theirs'])).toBe(false);

		const status = await statusCollector(repo);
		expect(status.mergeInProgress).toBe(true);
		expect(status.operationInProgress).toBe('rebase');
		expect(status.conflictedPaths).toEqual(['shared.txt']);
		expect(status.branch).toBe(trunk);
		expect(status.hasUpstream).toBe(false);

		await realGit(repo, ['rebase', '--abort']);
		expect((await statusCollector(repo)).mergeInProgress).toBe(false);
	});

	it('t13v does not report a successful rebase as in progress', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		const trunk = (await realGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		await realGit(repo, ['checkout', '-q', '-b', 'topic']);
		await writeFile(join(repo, 'topic.txt'), 'topic\n');
		await realGit(repo, ['add', '.']);
		await realGit(repo, ['commit', '-q', '-m', 'topic']);
		await realGit(repo, ['checkout', '-q', trunk]);
		await writeFile(join(repo, 'trunk.txt'), 'trunk\n');
		await realGit(repo, ['add', '.']);
		await realGit(repo, ['commit', '-q', '-m', 'trunk']);
		await realGit(repo, ['checkout', '-q', 'topic']);
		expect(await tryRealGit(repo, ['rebase', trunk])).toBe(true);
		expect((await statusCollector(repo)).mergeInProgress).toBe(false);
	});

	it('t13w resolves a linked worktree git dir for the in-progress probe', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initConflictingBranches(base);
		const checkout = join(dir, 'checkout');
		await realGit(base, ['worktree', 'add', '-q', checkout, '-b', 'malini/ws-linked']);
		await realGit(checkout, ['config', 'user.email', 't@example.com']);
		await realGit(checkout, ['config', 'user.name', 't']);
		expect(await tryRealGit(checkout, ['merge', 'theirs'])).toBe(false);
		expect((await statusCollector(checkout)).mergeInProgress).toBe(true);
		expect((await statusCollector(base)).mergeInProgress).toBe(false);
	});
});
