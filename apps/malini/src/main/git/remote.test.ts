import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { noPromptCredentialEnv, type GitCredentialEnv } from './credentials';
import {
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	tryRealGit,
	workstreamFixture,
	writeAttachmentFixture,
} from './fixtures.test-support';
import { AGENT_ATTACHMENTS_PATH } from './paths';
import {
	abortWorkstreamOperation,
	commitWorkstreamBranch,
	commitWorktreeChanges,
	MAX_ADDED_FILES_PER_COMMIT,
	pullWorkstreamBaseBranch,
	pushWorkstreamBranch,
} from './remote';
import { installGitRunnerForTests } from './run';
import { statusCollector } from './status';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('commitWorktreeChanges', () => {
	it('t18 excludes managed agent attachments even if pre-staged', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await writeAttachmentFixture(repo);
		await writeFile(join(repo, 'visible.txt'), 'visible commit\n');
		await realGit(repo, ['add', '.malini/agent-attachments']);

		const sha = await commitWorktreeChanges(repo, 'visible checkpoint');
		expect(sha).toMatch(/^[0-9a-f]{7,}$/);
		const names = await realGit(repo, ['show', '--pretty=format:', '--name-only', 'HEAD']);
		expect(names.split('\n')).toContain('visible.txt');
		expect(names).not.toContain('agent-attachments');
		expect(existsSync(join(repo, AGENT_ATTACHMENTS_PATH))).toBe(true);
	});

	it('refuses to sweep a flood of new files into a commit', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const repo = join(dir, 'repo');
		await initRealRepo(repo);
		await mkdir(join(repo, '.pnpm-store'));
		await Promise.all(
			Array.from({ length: MAX_ADDED_FILES_PER_COMMIT + 1 }, (_, index) =>
				writeFile(join(repo, '.pnpm-store', `f${index}`), `${index}\n`),
			),
		);
		const head = await realGit(repo, ['rev-parse', 'HEAD']);

		await expect(commitWorktreeChanges(repo, 'oops')).rejects.toThrow(
			`this commit would add ${MAX_ADDED_FILES_PER_COMMIT + 1} files`,
		);
		expect(await realGit(repo, ['rev-parse', 'HEAD'])).toBe(head);
	}, 30_000);
});

describe('commitWorkstreamBranch', () => {
	it('t13c rejects a branch mismatch before staging', async () => {
		const calls: string[][] = [];
		const restore = installGitRunnerForTests(async (args) => {
			calls.push([...args]);
			if (args.includes('--abbrev-ref')) return 'main\n';
			throw new Error('must not stage');
		});
		cleanups.push(async () => restore());
		await expect(commitWorkstreamBranch('/wt', 'ws-1', 'msg')).rejects.toThrow(
			'git error: workstream branch mismatch: expected `malini/ws-1`, got `main`',
		);
		expect(calls).toHaveLength(1);
	});

	it('commits on the workstream branch and reports the short sha', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await workstreamFixture(dir, 'ws-1');
		await writeFile(join(checkout, 'work.txt'), 'work\n');
		const sha = await commitWorkstreamBranch(checkout, 'ws-1', 'did work');
		expect((await realGit(checkout, ['rev-parse', '--short', 'HEAD'])).trim()).toBe(sha);
		expect((await realGit(checkout, ['log', '-1', '--format=%s|%an|%ae'])).trim()).toBe(
			'did work|malini|agent@malini.local',
		);
	});

	it('still commits on the legacy branch an existing workstream was created on', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const legacyBranch = 'smack/ws-1';
		const { checkout } = await workstreamFixture(dir, 'ws-1', legacyBranch);
		await writeFile(join(checkout, 'work.txt'), 'work\n');
		const sha = await commitWorkstreamBranch(checkout, 'ws-1', 'did work');
		expect((await realGit(checkout, ['rev-parse', '--short', legacyBranch])).trim()).toBe(sha);
	});

	it('rejects the legacy prefix for another workstream', async () => {
		const restore = installGitRunnerForTests(async (args) => {
			if (args.includes('--abbrev-ref')) return 'smack/ws-2\n';
			throw new Error('must not stage');
		});
		cleanups.push(async () => restore());
		await expect(commitWorkstreamBranch('/wt', 'ws-1', 'msg')).rejects.toThrow(
			'workstream branch mismatch: expected `malini/ws-1`',
		);
	});
});

describe('pushWorkstreamBranch', () => {
	it('t13a pushes the workstream branch to the canonical URL with the credential env', async () => {
		const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
		const restore = installGitRunnerForTests(async (args, env) => {
			calls.push({ args: [...args], env: { ...env } });
			if (args.includes('--abbrev-ref')) return 'malini/ws-1\n';
			if (args.includes('get-url')) return 'https://github.com/acme/repo.git\n';
			return '';
		});
		cleanups.push(async () => restore());
		const credentials: GitCredentialEnv = {
			prepare: async (token) => ({ GIT_TERMINAL_PROMPT: '0', MALINI_TEST_TOKEN: token ?? 'none' }),
		};

		const branch = await pushWorkstreamBranch('/wt', 'ws-1', 'acme/repo', 'ghs_live', credentials);

		expect(branch).toBe('malini/ws-1');
		const push = calls.find((call) => call.args.includes('push'));
		expect(push?.args).toEqual([
			'-C',
			'/wt',
			'-c',
			'credential.helper=',
			'-c',
			'credential.helper=!gh auth git-credential',
			'-c',
			'core.hooksPath=/dev/null',
			'-c',
			'protocol.allow=never',
			'-c',
			'protocol.https.allow=always',
			'-c',
			'http.sslVerify=true',
			'push',
			'--no-verify',
			'https://github.com/acme/repo.git',
			'malini/ws-1:refs/heads/malini/ws-1',
		]);
		expect(push?.env).toEqual({ GIT_TERMINAL_PROMPT: '0', MALINI_TEST_TOKEN: 'ghs_live' });
		expect(calls.every((call) => !call.args.some((arg) => arg.includes('ghs_live')))).toBe(true);
		const afterPush = calls.slice(calls.indexOf(push!) + 1);
		expect(
			afterPush.map((call) => call.args.filter((arg) => !arg.startsWith('-')).slice(1)),
		).toEqual([
			['core.hooksPath=/dev/null', 'update-ref', 'refs/remotes/origin/malini/ws-1', 'HEAD'],
			['config', 'branch.malini/ws-1.remote', 'origin'],
			['config', 'branch.malini/ws-1.merge', 'refs/heads/malini/ws-1'],
		]);
		expect(afterPush.every((call) => Object.keys(call.env).length === 0)).toBe(true);
	});

	it('t13b rejects a branch mismatch', async () => {
		const restore = installGitRunnerForTests(async (args) => {
			if (args.includes('--abbrev-ref')) return 'main\n';
			throw new Error('must not push');
		});
		cleanups.push(async () => restore());
		await expect(
			pushWorkstreamBranch('/wt', 'ws-1', 'acme/repo', null, noPromptCredentialEnv),
		).rejects.toThrow('workstream branch mismatch: expected `malini/ws-1`, got `main`');
	});

	it('pushes the legacy branch an existing workstream is checked out on, keeping its pull request head', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const legacyBranch = 'smack/ws-1';
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1', legacyBranch);
		await writeFile(join(checkout, 'work.txt'), 'work\n');
		await commitWorkstreamBranch(checkout, 'ws-1', 'did work');

		const branch = await pushThroughLocalRemote(checkout, remote);

		expect(branch).toBe(legacyBranch);
		expect((await realGit(remote, ['rev-parse', legacyBranch])).trim()).toBe(
			(await realGit(checkout, ['rev-parse', 'HEAD'])).trim(),
		);
		expect((await realGit(remote, ['branch', '--list', 'malini/ws-1'])).trim()).toBe('');
		expect((await realGit(checkout, ['config', `branch.${legacyBranch}.merge`])).trim()).toBe(
			`refs/heads/${legacyBranch}`,
		);
	});

	async function pushThroughLocalRemote(checkout: string, remote: string): Promise<string> {
		const restore = installGitRunnerForTests(async (args, env, real) => {
			if (args.includes('get-url')) return 'https://github.com/acme/repo.git\n';
			const local = args
				.map((arg) => (arg === 'https://github.com/acme/repo.git' ? remote : arg))
				.filter(
					(arg, index, all) =>
						arg !== 'protocol.allow=never' && all[index + 1] !== 'protocol.allow=never',
				);
			return real(local, env);
		});
		try {
			return await pushWorkstreamBranch(checkout, 'ws-1', 'acme/repo', null, noPromptCredentialEnv);
		} finally {
			restore();
		}
	}

	async function commitOnRemoteBranch(dir: string, remote: string, file: string, text: string) {
		const other = join(dir, 'other');
		await realGit(dir, ['clone', '-q', '-b', 'malini/ws-1', remote, other]);
		await realGit(other, ['config', 'user.email', 't@example.com']);
		await realGit(other, ['config', 'user.name', 't']);
		await writeFile(join(other, file), text);
		await realGit(other, ['add', '.']);
		await realGit(other, ['commit', '-q', '-m', 'updated on GitHub']);
		await realGit(other, ['push', '-q', 'origin', 'malini/ws-1']);
	}

	it('merges commits GitHub added to the branch, then pushes both', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1');
		await realGit(checkout, ['push', '-q', 'origin', 'malini/ws-1']);
		await commitOnRemoteBranch(dir, remote, 'remote.txt', 'remote\n');
		await writeFile(join(checkout, 'local.txt'), 'local\n');
		await commitWorkstreamBranch(checkout, 'ws-1', 'local work');

		await pushThroughLocalRemote(checkout, remote);

		const pushed = (await realGit(remote, ['ls-tree', '--name-only', 'malini/ws-1'])).split('\n');
		expect(pushed).toEqual(expect.arrayContaining(['local.txt', 'remote.txt']));
		expect((await realGit(remote, ['rev-parse', 'malini/ws-1'])).trim()).toBe(
			(await realGit(checkout, ['rev-parse', 'HEAD'])).trim(),
		);
		expect((await realGit(checkout, ['log', '-1', '--format=%s'])).trim()).toBe(
			"Merge remote-tracking branch 'origin/malini/ws-1' into malini/ws-1",
		);
	});

	it('says plainly when commits GitHub added do not merge, and leaves no merge behind', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1');
		await realGit(checkout, ['push', '-q', 'origin', 'malini/ws-1']);
		await commitOnRemoteBranch(dir, remote, 'shared.txt', 'theirs\n');
		await writeFile(join(checkout, 'shared.txt'), 'ours\n');
		await commitWorkstreamBranch(checkout, 'ws-1', 'local work');
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();

		await expect(pushThroughLocalRemote(checkout, remote)).rejects.toThrow(
			'GitHub has commits on malini/ws-1 that do not merge cleanly with this workstream',
		);
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		expect((await realGit(checkout, ['status', '--porcelain'])).trim()).toBe('');
	});

	it('t13i rejects a repository-configured remote before any token is used', async () => {
		const calls: string[][] = [];
		const restore = installGitRunnerForTests(async (args) => {
			calls.push([...args]);
			if (args.includes('--abbrev-ref')) return 'malini/ws-1\n';
			if (args.includes('get-url')) return 'ext::sh -c evil\n';
			return '';
		});
		cleanups.push(async () => restore());
		await expect(
			pushWorkstreamBranch('/wt', 'ws-1', 'acme/repo', 'ghs_live', noPromptCredentialEnv),
		).rejects.toThrow('workstream origin no longer matches the selected GitHub repository');
		expect(calls.some((argv) => argv.includes('push'))).toBe(false);
	});

	it('refuses an invalid repository full name before looking at the checkout', async () => {
		const restore = installGitRunnerForTests(async () => {
			throw new Error('git must not run');
		});
		cleanups.push(async () => restore());
		await expect(
			pushWorkstreamBranch('/wt', 'ws-1', 'not-a-full-name', null, noPromptCredentialEnv),
		).rejects.toThrow('unsafe path: invalid GitHub repository full name');
	});
});

describe('pullWorkstreamBaseBranch', () => {
	it('t13g rejects a dirty worktree before fetching', async () => {
		let calls = 0;
		const restore = installGitRunnerForTests(async (args) => {
			calls += 1;
			if (args.includes('status')) return '## malini/ws-1...origin/malini/ws-1\0 M src/lib.rs\0';
			if (args.includes('rev-parse') && args.includes('--verify') && args.includes('HEAD')) {
				return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
			}
			if (args.includes('rev-parse') && args.includes('--git-dir')) return '';
			throw new Error(`pull should stop before fetching a dirty worktree: ${args.join(' ')}`);
		});
		cleanups.push(async () => restore());
		await expect(
			pullWorkstreamBaseBranch('/wt', 'ws-1', 'main', null, noPromptCredentialEnv),
		).rejects.toThrow(
			'git error: commit or discard local changes before pulling the target branch',
		);
		expect(calls).toBe(3);
	});

	it('t13f fetches and merges the base branch into a clean workstream', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1');
		const other = join(dir, 'other');
		await realGit(dir, ['clone', '-q', remote, other]);
		await realGit(other, ['config', 'user.email', 't@example.com']);
		await realGit(other, ['config', 'user.name', 't']);
		await writeFile(join(other, 'upstream.txt'), 'upstream\n');
		await realGit(other, ['add', '.']);
		await realGit(other, ['commit', '-q', '-m', 'upstream']);
		await realGit(other, ['push', '-q', 'origin', 'main']);

		const sha = await pullWorkstreamBaseBranch(
			checkout,
			'ws-1',
			'main',
			null,
			noPromptCredentialEnv,
		);
		expect((await realGit(checkout, ['rev-parse', '--short', 'HEAD'])).trim()).toBe(sha);
		expect(existsSync(join(checkout, 'upstream.txt'))).toBe(true);
		expect((await realGit(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
			'malini/ws-1',
		);
	});

	it('pulls the base branch into a checkout still on its legacy branch', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const legacyBranch = 'smack/ws-1';
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1', legacyBranch);
		const other = join(dir, 'other');
		await realGit(dir, ['clone', '-q', remote, other]);
		await realGit(other, ['config', 'user.email', 't@example.com']);
		await realGit(other, ['config', 'user.name', 't']);
		await writeFile(join(other, 'upstream.txt'), 'upstream\n');
		await realGit(other, ['add', '.']);
		await realGit(other, ['commit', '-q', '-m', 'upstream']);
		await realGit(other, ['push', '-q', 'origin', 'main']);

		await pullWorkstreamBaseBranch(checkout, 'ws-1', 'main', null, noPromptCredentialEnv);

		expect(existsSync(join(checkout, 'upstream.txt'))).toBe(true);
		expect((await realGit(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
			legacyBranch,
		);
	});

	it('holds a conflicting merge in the checkout for the agent to resolve', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await conflictingBaseFixture(dir);
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
		const shortHead = (await realGit(checkout, ['rev-parse', '--short', 'HEAD'])).trim();

		expect(
			await pullWorkstreamBaseBranch(checkout, 'ws-1', 'main', null, noPromptCredentialEnv),
		).toBe(shortHead);

		const status = await statusCollector(checkout);
		expect(status.mergeInProgress).toBe(true);
		expect(status.conflictedPaths).toEqual(['seed.txt']);
		expect(status.conflictMarkerPaths).toEqual(['seed.txt']);
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		await expect(
			pullWorkstreamBaseBranch(checkout, 'ws-1', 'main', null, noPromptCredentialEnv),
		).rejects.toThrow('a merge is already in progress in this workstream');
	});
});

describe('a rebase, cherry-pick or revert stopped in the checkout', () => {
	it.each(['rebase', 'cherry-pick', 'revert'] as const)(
		'reports a stopped %s, refuses to commit through it, and aborts it',
		async (operation) => {
			const dir = await tempDir();
			cleanups.push(() => removeDir(dir));
			const { checkout, head } = await stoppedOperation(dir, operation);

			const status = await statusCollector(checkout);
			expect([status.operationInProgress, status.mergeInProgress]).toEqual([operation, true]);
			expect(status.branch).toBe('malini/ws-1');
			await expect(commitWorktreeChanges(checkout, 'through it')).rejects.toThrow(
				`A ${operation} is in progress in this workstream. Finish or abort it before committing.`,
			);

			await abortWorkstreamOperation(checkout, 'ws-1');

			const settled = await statusCollector(checkout);
			expect([settled.operationInProgress, settled.dirtyPaths]).toEqual([null, []]);
			expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		},
	);
});

async function stoppedOperation(
	dir: string,
	operation: 'rebase' | 'cherry-pick' | 'revert',
): Promise<{ checkout: string; head: string }> {
	const { checkout } = await workstreamFixture(dir, 'ws-1');
	const commit = async (content: string, message: string): Promise<void> => {
		await writeFile(join(checkout, 'seed.txt'), content);
		await realGit(checkout, ['commit', '-qam', message]);
	};
	await realGit(checkout, ['checkout', '-q', '-b', 'theirs']);
	await commit('theirs\n', 'theirs');
	await realGit(checkout, ['checkout', '-q', 'malini/ws-1']);
	await commit('ours\n', 'ours');
	if (operation === 'revert') await commit('ours again\n', 'ours again');
	const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
	const stop = operation === 'revert' ? ['revert', '--no-edit', 'HEAD~1'] : [operation, 'theirs'];
	expect(await tryRealGit(checkout, stop)).toBe(false);
	return { checkout, head };
}

describe('a merge held in the checkout', () => {
	it('refuses to commit while a file still holds conflict markers', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await heldConflict(dir);
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();

		await expect(commitWorkstreamBranch(checkout, 'ws-1', 'merge')).rejects.toThrow(
			'Conflict markers remain in seed.txt. Resolve them, then commit again.',
		);
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		expect((await statusCollector(checkout)).conflictMarkerPaths).toEqual(['seed.txt']);
	});

	it('completes the merge commit with both parents once the markers are gone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await heldConflict(dir);
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
		const base = (await realGit(checkout, ['rev-parse', 'origin/main'])).trim();
		await writeFile(join(checkout, 'seed.txt'), 'ours\ntheirs\n');
		await writeFile(join(checkout, 'fix.txt'), 'made the merge build\n');

		await commitWorkstreamBranch(checkout, 'ws-1', 'ignored for a merge');

		expect((await realGit(checkout, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim()).toBe(
			`${(await realGit(checkout, ['rev-parse', 'HEAD'])).trim()} ${head} ${base}`,
		);
		expect((await realGit(checkout, ['log', '-1', '--format=%B'])).trim()).toBe(
			"Merge remote-tracking branch 'origin/main' into malini/ws-1",
		);
		expect(
			(await realGit(checkout, ['show', '--pretty=format:', '--name-only', 'HEAD'])).split('\n'),
		).toEqual(expect.arrayContaining(['fix.txt', 'seed.txt']));
		const status = await statusCollector(checkout);
		expect([status.mergeInProgress, status.dirtyPaths]).toEqual([false, []]);
	});

	it('takes the content in place for a binary conflict that carries no markers', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await heldConflict(
			dir,
			'logo.bin',
			Buffer.from([0, 1, 2]),
			Buffer.from([0, 9, 9]),
		);

		const status = await statusCollector(checkout);
		expect(status.conflictedPaths).toEqual(['logo.bin']);
		expect(status.conflictMarkerPaths).toEqual([]);

		await commitWorkstreamBranch(checkout, 'ws-1', 'merge');
		expect(
			(await realGit(checkout, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' '),
		).toHaveLength(3);
		expect((await statusCollector(checkout)).mergeInProgress).toBe(false);
	});

	it('does not count the files the base added as new files in the merge commit', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, checkout } = await workstreamFixture(dir, 'ws-1');
		const other = await baseClone(dir, remote);
		await mkdir(join(other, 'vendor'));
		await Promise.all(
			Array.from({ length: MAX_ADDED_FILES_PER_COMMIT + 1 }, (_, index) =>
				writeFile(join(other, 'vendor', `f${index}`), `${index}\n`),
			),
		);
		await writeFile(join(other, 'seed.txt'), 'theirs\n');
		await realGit(other, ['add', '.']);
		await realGit(other, ['commit', '-q', '-m', 'vendor and theirs']);
		await realGit(other, ['push', '-q', 'origin', 'main']);
		await writeFile(join(checkout, 'seed.txt'), 'ours\n');
		await realGit(checkout, ['commit', '-q', '-am', 'ours']);
		await pullWorkstreamBaseBranch(checkout, 'ws-1', 'main', null, noPromptCredentialEnv);
		await writeFile(join(checkout, 'seed.txt'), 'ours\ntheirs\n');

		await commitWorkstreamBranch(checkout, 'ws-1', 'merge');

		expect((await statusCollector(checkout)).mergeInProgress).toBe(false);
	}, 60_000);

	it('aborts the merge and returns the checkout to its last commit', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { checkout } = await heldConflict(dir);
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
		await writeFile(join(checkout, 'seed.txt'), 'half resolved\n');

		await abortWorkstreamOperation(checkout, 'ws-1');

		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(head);
		const status = await statusCollector(checkout);
		expect([status.mergeInProgress, status.dirtyPaths]).toEqual([false, []]);
		await expect(abortWorkstreamOperation(checkout, 'ws-1')).rejects.toThrow(
			'no merge, rebase, cherry-pick or revert is in progress in this workstream',
		);
	});
});

async function baseClone(dir: string, remote: string): Promise<string> {
	const other = join(dir, 'other');
	await realGit(dir, ['clone', '-q', remote, other]);
	await realGit(other, ['config', 'user.email', 't@example.com']);
	await realGit(other, ['config', 'user.name', 't']);
	return other;
}

async function commitOnBase(
	dir: string,
	remote: string,
	file: string,
	content: string | Buffer,
): Promise<void> {
	const other = await baseClone(dir, remote);
	await writeFile(join(other, file), content);
	await realGit(other, ['add', '.']);
	await realGit(other, ['commit', '-q', '-m', 'theirs']);
	await realGit(other, ['push', '-q', 'origin', 'main']);
}

async function conflictingBaseFixture(
	dir: string,
	file = 'seed.txt',
	theirs: string | Buffer = 'theirs\n',
	ours: string | Buffer = 'ours\n',
): Promise<{ checkout: string }> {
	const { remote, checkout } = await workstreamFixture(dir, 'ws-1');
	await commitOnBase(dir, remote, file, theirs);
	await writeFile(join(checkout, file), ours);
	await realGit(checkout, ['add', '.']);
	await realGit(checkout, ['commit', '-q', '-m', 'ours']);
	return { checkout };
}

async function heldConflict(
	dir: string,
	file?: string,
	theirs?: string | Buffer,
	ours?: string | Buffer,
): Promise<{ checkout: string }> {
	const fixture = await conflictingBaseFixture(dir, file, theirs, ours);
	await pullWorkstreamBaseBranch(fixture.checkout, 'ws-1', 'main', null, noPromptCredentialEnv);
	return fixture;
}
