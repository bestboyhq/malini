import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AGENT_ATTACHMENTS_PATH, SANDBOX_SCRATCH_PATH, workstreamBranchName } from './paths';

const execFileAsync = promisify(execFile);

export async function tempDir(prefix = 'malini-git-'): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

export function removeDir(path: string): Promise<void> {
	return rm(path, { recursive: true, force: true });
}

export async function realGit(repo: string, args: readonly string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', [...args], {
		cwd: repo,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
		maxBuffer: 64 * 1024 * 1024,
	});
	return stdout;
}

export async function tryRealGit(repo: string, args: readonly string[]): Promise<boolean> {
	try {
		await realGit(repo, args);
		return true;
	} catch {
		return false;
	}
}

export async function initRealRepo(repo: string): Promise<void> {
	await mkdir(repo, { recursive: true });
	await realGit(repo, ['init', '-q']);
	await realGit(repo, ['config', 'user.email', 't@example.com']);
	await realGit(repo, ['config', 'user.name', 't']);
	await writeFile(join(repo, 'seed.txt'), 'seed\n');
	await realGit(repo, ['add', '.']);
	await realGit(repo, ['commit', '-q', '-m', 'seed']);
}

export async function initConflictingBranches(repo: string): Promise<string> {
	await initRealRepo(repo);
	await writeFile(join(repo, 'shared.txt'), 'base\n');
	await realGit(repo, ['add', '.']);
	await realGit(repo, ['commit', '-q', '-m', 'shared']);
	const trunk = (await realGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	await realGit(repo, ['checkout', '-q', '-b', 'theirs']);
	await writeFile(join(repo, 'shared.txt'), 'theirs\n');
	await realGit(repo, ['commit', '-q', '-am', 'theirs']);
	await realGit(repo, ['checkout', '-q', trunk]);
	await writeFile(join(repo, 'shared.txt'), 'ours\n');
	await realGit(repo, ['commit', '-q', '-am', 'ours']);
	return trunk;
}

export async function writeAttachmentFixture(repo: string): Promise<void> {
	const attachment = join(repo, AGENT_ATTACHMENTS_PATH, 'att-test');
	await mkdir(attachment, { recursive: true });
	await writeFile(join(attachment, 'payload.txt'), 'private transport bytes\n');
}

export async function writeSandboxScratchFixture(repo: string): Promise<void> {
	const cache = join(repo, SANDBOX_SCRATCH_PATH, 'tmp', 'node-compile-cache', 'v22.23.0-arm64');
	await mkdir(cache, { recursive: true });
	await writeFile(join(cache, '0004ef591'), Buffer.from([0, 159, 146, 150]));
	const scratch = join(repo, SANDBOX_SCRATCH_PATH, 'tmp', 'run-cfkd8n');
	await mkdir(scratch, { recursive: true });
	await writeFile(join(scratch, 'journal.jsonl'), '{"step":1}\n');
	const config = join(repo, SANDBOX_SCRATCH_PATH, 'config');
	await mkdir(config, { recursive: true });
	await writeFile(join(config, 'settings.json'), '{}\n');
}

export async function workstreamFixture(
	appDataRoot: string,
	workstreamId: string,
	branch = workstreamBranchName(workstreamId),
): Promise<{ remote: string; base: string; checkout: string }> {
	const remote = join(appDataRoot, 'remote.git');
	await mkdir(remote, { recursive: true });
	await realGit(remote, ['init', '-q', '--bare', '-b', 'main']);
	const seed = join(appDataRoot, 'seed');
	await initRealRepo(seed);
	await realGit(seed, ['branch', '-M', 'main']);
	await realGit(seed, ['remote', 'add', 'origin', remote]);
	await realGit(seed, ['push', '-q', 'origin', 'main']);
	await removeDir(seed);

	const base = join(appDataRoot, 'repositories', 'proj', 'base');
	await mkdir(join(appDataRoot, 'repositories', 'proj'), { recursive: true });
	await realGit(appDataRoot, ['clone', '-q', remote, base]);
	await realGit(base, ['config', 'user.email', 't@example.com']);
	await realGit(base, ['config', 'user.name', 't']);

	const checkout = join(appDataRoot, 'workstreams', workstreamId);
	await mkdir(join(appDataRoot, 'workstreams'), { recursive: true });
	await realGit(base, ['worktree', 'add', '-q', checkout, '-b', branch, 'origin/main']);
	await realGit(checkout, ['config', 'user.email', 't@example.com']);
	await realGit(checkout, ['config', 'user.name', 't']);
	return { remote, base, checkout };
}
