import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCode } from '$main/errors';
import { commitPaths } from '$main/git/remote';
import { DISABLED_GIT_HOOKS_CONFIG, runGit, runGitAllowingExit } from '$main/git/run';

const ORIGIN_MAIN = 'refs/remotes/origin/main';

const README = [
	'# Brain',
	'',
	'What Malini captured from your chats, one file per day in log/, and the notes it writes from them in notes/.',
	'',
].join('\n');

export async function commitsAhead(checkout: string): Promise<number> {
	const missing = await runGitAllowingExit(
		['-C', checkout, 'rev-parse', '--verify', '--quiet', ORIGIN_MAIN],
		1,
	);
	const range = missing.allowed ? 'HEAD' : `${ORIGIN_MAIN}..HEAD`;
	return Number((await runGit(['-C', checkout, 'rev-list', '--count', range])).trim()) || 0;
}

export async function restoreLog(checkout: string): Promise<void> {
	const tracked = await runGit(['-C', checkout, 'ls-tree', '-d', '--name-only', 'HEAD', 'log']);
	if (tracked.trim().length > 0) {
		await runGit([
			'-C',
			checkout,
			'restore',
			'--source=HEAD',
			'--staged',
			'--worktree',
			'--',
			'log',
		]);
	} else {
		await runGit(['-C', checkout, 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', 'log']);
	}
	await runGit(['-C', checkout, 'clean', '-f', '-d', '-q', '--', 'log']);
}

export async function pushToFolderOrigin(checkout: string): Promise<void> {
	await runGit([
		'-C',
		checkout,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'push',
		'-q',
		'origin',
		'HEAD:refs/heads/main',
	]);
	await runGit(['-C', checkout, 'update-ref', ORIGIN_MAIN, 'HEAD']);
}

export async function startFolderBrain(folder: string): Promise<void> {
	await mkdir(folder, { recursive: true });
	if (await isMissing(join(folder, '.git'))) {
		await runGit(['init', '-q', '-b', 'main', folder]);
		await writeFile(join(folder, 'README.md'), README);
		await commitPaths(folder, 'Start the brain', ['README.md']);
	}
	await runGit(['-C', folder, 'config', 'receive.denyCurrentBranch', 'updateInstead']);
	await runGit(['-C', folder, 'config', 'core.hooksPath', '/dev/null']);
}

export async function isMissing(path: string): Promise<boolean> {
	try {
		await stat(path);
		return false;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return true;
		throw error;
	}
}
