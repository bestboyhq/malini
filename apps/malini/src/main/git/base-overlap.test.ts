import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { baseOverlap, changesWithEveryCommit, commitOf } from './base-overlap';
import { initRealRepo, realGit, removeDir, tempDir } from './fixtures.test-support';

const TEN_LINES = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

async function repoWith(files: Readonly<Record<string, string>>): Promise<string> {
	const root = await tempDir('malini-overlap-');
	cleanups.push(() => removeDir(root));
	await initRealRepo(root);
	await realGit(root, ['branch', '-M', 'main']);
	await commitFiles(root, files, 'fork point');
	await realGit(root, ['branch', 'topic']);
	return root;
}

async function commitFiles(
	repo: string,
	files: Readonly<Record<string, string>>,
	message: string,
): Promise<void> {
	for (const [path, contents] of Object.entries(files)) await writeFile(join(repo, path), contents);
	await realGit(repo, ['add', '-A']);
	await realGit(repo, ['commit', '-q', '-m', message]);
}

async function onBranch(
	repo: string,
	branch: string,
	files: Readonly<Record<string, string>>,
): Promise<void> {
	await realGit(repo, ['checkout', '-q', branch]);
	await commitFiles(repo, files, `${branch} change`);
}

async function overlapOfTopic(repo: string): ReturnType<typeof baseOverlap> {
	await realGit(repo, ['checkout', '-q', 'topic']);
	const head = await commitOf(repo, 'HEAD');
	const baseHead = await commitOf(repo, 'main');
	if (head === null || baseHead === null) throw new Error('the fixture lost a branch');
	return baseOverlap(repo, head, baseHead);
}

describe('baseOverlap', () => {
	it('names the files merging the base would stop on', async () => {
		const repo = await repoWith({ 'shared.txt': 'base\n', 'other.txt': 'other\n' });
		await onBranch(repo, 'topic', { 'shared.txt': 'topic\n' });
		await onBranch(repo, 'main', { 'shared.txt': 'main\n', 'other.txt': 'moved\n' });

		expect(await overlapOfTopic(repo)).toEqual({
			behind: 1,
			conflictedPaths: ['shared.txt'],
			overlappingPaths: ['shared.txt'],
		});
	});

	it('names a file both sides changed even when the merge is clean', async () => {
		const repo = await repoWith({ 'lines.txt': TEN_LINES });
		await onBranch(repo, 'topic', { 'lines.txt': TEN_LINES.replace('1\n', 'one\n') });
		await onBranch(repo, 'main', { 'lines.txt': TEN_LINES.replace('10\n', 'ten\n') });
		await onBranch(repo, 'main', { 'unrelated.txt': 'more\n' });

		expect(await overlapOfTopic(repo)).toEqual({
			behind: 2,
			conflictedPaths: [],
			overlappingPaths: ['lines.txt'],
		});
	});

	it('finds nothing when the base changed only files the branch left alone', async () => {
		const repo = await repoWith({ 'mine.txt': 'a\n', 'theirs.txt': 'b\n' });
		await onBranch(repo, 'topic', { 'mine.txt': 'topic\n' });
		await onBranch(repo, 'main', { 'theirs.txt': 'main\n' });

		expect(await overlapOfTopic(repo)).toBeNull();
	});

	it('ignores lockfiles, changelogs and generated files that merge cleanly, but not their conflicts', async () => {
		const repo = await repoWith({
			'.gitattributes': 'contract.generated.ts linguist-generated\n',
			'pnpm-lock.yaml': TEN_LINES,
			'CHANGELOG.md': TEN_LINES,
			'contract.generated.ts': TEN_LINES,
			'yarn.lock': 'base\n',
		});
		await onBranch(repo, 'topic', {
			'pnpm-lock.yaml': TEN_LINES.replace('1\n', 'one\n'),
			'CHANGELOG.md': TEN_LINES.replace('1\n', 'one\n'),
			'contract.generated.ts': TEN_LINES.replace('1\n', 'one\n'),
		});
		await onBranch(repo, 'main', {
			'pnpm-lock.yaml': TEN_LINES.replace('10\n', 'ten\n'),
			'CHANGELOG.md': TEN_LINES.replace('10\n', 'ten\n'),
			'contract.generated.ts': TEN_LINES.replace('10\n', 'ten\n'),
		});
		expect(await overlapOfTopic(repo)).toBeNull();

		await onBranch(repo, 'topic', { 'yarn.lock': 'topic\n' });
		await onBranch(repo, 'main', { 'yarn.lock': 'main\n' });
		expect(await overlapOfTopic(repo)).toEqual({
			behind: 2,
			conflictedPaths: ['yarn.lock'],
			overlappingPaths: ['yarn.lock'],
		});
	});

	it('finds nothing for a branch the base already holds or one with no commits of its own', async () => {
		const repo = await repoWith({ 'shared.txt': 'base\n' });
		await onBranch(repo, 'topic', { 'shared.txt': 'topic\n' });
		expect(await overlapOfTopic(repo)).toBeNull();

		await realGit(repo, ['checkout', '-q', 'main']);
		await realGit(repo, ['merge', '-q', '--ff-only', 'topic']);
		await commitFiles(repo, { 'shared.txt': 'main\n' }, 'main moves on');
		expect(await overlapOfTopic(repo)).toBeNull();
	});
});

describe('commitOf', () => {
	it('reads a ref that is missing as null', async () => {
		const repo = await repoWith({ 'shared.txt': 'base\n' });

		expect(await commitOf(repo, 'refs/remotes/origin/main')).toBeNull();
		expect(await commitOf(repo, 'main')).toMatch(/^[0-9a-f]{40}$/u);
	});
});

describe('changesWithEveryCommit', () => {
	it('knows lockfiles and changelogs anywhere in the tree', () => {
		expect(
			['apps/site/pnpm-lock.yaml', 'Cargo.lock', 'docs/CHANGELOG.md', 'CHANGES', 'go.sum'].every(
				changesWithEveryCommit,
			),
		).toBe(true);
		expect(['src/lock.ts', 'changelog-parser.ts', 'go.mod'].some(changesWithEveryCommit)).toBe(
			false,
		);
	});
});
