import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitPaths, MAIN_DIVERGED, pushHeadToGithubMain } from '$main/git/remote';
import { installGitRunnerForTests } from '$main/git/run';
import { commitsAhead, pushToFolderOrigin, restoreLog, startFolderBrain } from './brain-git';

const GITHUB_BRAIN = 'https://github.com/acme/brain.git';

let root: string;

async function git(cwd: string, args: readonly string[]): Promise<string> {
	const { stdout } = await promisify(execFile)('git', [...args], { cwd });
	return stdout.trim();
}

async function cloneOf(origin: string, name: string): Promise<string> {
	const path = join(root, name);
	await git(root, ['clone', '-q', origin, path]);
	await git(path, ['config', 'user.email', 'brain@example.com']);
	await git(path, ['config', 'user.name', 'Brain']);
	return path;
}

async function write(checkout: string, path: string, text: string): Promise<void> {
	await mkdir(join(checkout, path, '..'), { recursive: true });
	await writeFile(join(checkout, path), text);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-brain-git-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('a brain kept on this Mac', () => {
	it('starts once, then takes each landing on its main', async () => {
		const origin = join(root, 'brain');
		await startFolderBrain(origin);
		await startFolderBrain(origin);
		expect(await git(origin, ['log', '--format=%s'])).toBe('Start the brain');

		const checkout = await cloneOf(origin, 'checkout');
		await write(checkout, 'log/2026-11-07.md', '# 2026-11-07\n');
		expect(await commitPaths(checkout, 'Capture 1 chat', ['log'])).toBe(true);
		expect(await commitPaths(checkout, 'Capture 1 chat', ['log'])).toBe(false);
		expect(await commitsAhead(checkout)).toBe(1);

		await pushToFolderOrigin(checkout);
		expect(await commitsAhead(checkout)).toBe(0);
		expect(await readFile(join(origin, 'log/2026-11-07.md'), 'utf8')).toBe('# 2026-11-07\n');
	});
});

describe('landing the notes', () => {
	it('puts back whatever the agent did under log/ and keeps its notes', async () => {
		const origin = join(root, 'brain');
		await startFolderBrain(origin);
		const checkout = await cloneOf(origin, 'checkout');
		await write(checkout, 'log/2026-11-07.md', '# 2026-11-07\n');
		await commitPaths(checkout, 'Capture 1 chat', ['log']);

		await write(checkout, 'log/2026-11-07.md', 'rewritten by the agent\n');
		await write(checkout, 'log/2026-11-08.md', 'invented by the agent\n');
		await git(checkout, ['add', 'log/2026-11-08.md']);
		await write(checkout, 'notes/products.md', '# Products\n');
		await restoreLog(checkout);
		expect(await commitPaths(checkout, 'Rewrite notes', ['.'])).toBe(true);

		expect(await git(checkout, ['show', '--name-only', '--format=', 'HEAD'])).toBe(
			'notes/products.md',
		);
		expect(await git(checkout, ['status', '--porcelain'])).toBe('');
		expect(await readFile(join(checkout, 'log/2026-11-07.md'), 'utf8')).toBe('# 2026-11-07\n');
	});

	it('drops a log/ the agent made before the first capture', async () => {
		const origin = join(root, 'brain');
		await startFolderBrain(origin);
		const checkout = await cloneOf(origin, 'checkout');
		await write(checkout, 'log/2026-11-07.md', 'invented\n');
		await restoreLog(checkout);
		expect(await git(checkout, ['status', '--porcelain'])).toBe('');
	});
});

describe('pushing the brain to its main on GitHub', () => {
	let remote: string;
	let restore: () => void;

	beforeEach(async () => {
		remote = join(root, 'remote.git');
		await git(root, ['init', '-q', '--bare', '-b', 'main', remote]);
		const seed = await cloneOf(remote, 'seed');
		await write(seed, 'README.md', '# Brain\n');
		await git(seed, ['add', '.']);
		await git(seed, ['commit', '-q', '-m', 'Initial commit']);
		await git(seed, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
		restore = installGitRunnerForTests((args, env, previous) =>
			previous(
				[
					'-c',
					'protocol.file.allow=always',
					...args.map((arg) => (arg === GITHUB_BRAIN ? remote : arg)),
				],
				env,
			),
		);
	});

	afterEach(() => restore());

	it('rebases once over notes landed elsewhere, then pushes', async () => {
		const here = await cloneOf(remote, 'here');
		await write(here, 'log/2026-11-07.md', '# 2026-11-07\n');
		await commitPaths(here, 'Capture 1 chat', ['log']);
		await pushHeadToGithubMain(here, 'acme/brain');
		expect(await git(remote, ['rev-parse', 'main'])).toBe(await git(here, ['rev-parse', 'HEAD']));

		const elsewhere = await cloneOf(remote, 'elsewhere');

		await write(elsewhere, 'notes/people.md', '# People\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, ['commit', '-q', '-m', 'Rewrite notes']);
		await git(elsewhere, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
		await write(here, 'log/2026-11-07.md', '# 2026-11-07\n\nMore\n');
		await commitPaths(here, 'Capture 1 chat', ['log']);

		await pushHeadToGithubMain(here, 'acme/brain');
		expect(await git(remote, ['log', '--format=%s', 'main'])).toBe(
			'Capture 1 chat\nRewrite notes\nCapture 1 chat\nInitial commit',
		);
		expect(await commitsAhead(here)).toBe(0);
	});

	it('stops on a clash, keeps its own commit and leaves no rebase behind', async () => {
		const here = await cloneOf(remote, 'here');
		const elsewhere = await cloneOf(remote, 'elsewhere');
		await write(elsewhere, 'README.md', '# Their brain\n');
		await git(elsewhere, ['commit', '-q', '-am', 'Theirs']);
		await git(elsewhere, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
		await write(here, 'README.md', '# Our brain\n');
		await commitPaths(here, 'Ours', ['README.md']);

		await expect(pushHeadToGithubMain(here, 'acme/brain')).rejects.toThrow(MAIN_DIVERGED);
		expect(await git(here, ['log', '-1', '--format=%s'])).toBe('Ours');
		expect(await git(here, ['status', '--porcelain'])).toBe('');
		expect(await commitsAhead(here)).toBe(1);
	});
});
