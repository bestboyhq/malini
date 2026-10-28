import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promises as originalFs } from 'original-fs';
import {
	GH_CREDENTIAL_HELPER_CONFIG,
	normalizeGithubToken,
	type GitCredentialEnv,
} from '$main/git/credentials';
import { deriveProjectId, repositoryBaseDir } from '$main/git/paths';
import { describeError, GitError } from '$main/errors';
import { DISABLED_GIT_HOOKS_CONFIG, runGit, type GitEnv } from '$main/git/run';
import { branchList, withProjectLock } from '$main/git/worktrees';

export type ProgressStage = 'fetch' | 'checkout' | 'done';

export interface Progress {
	stage: ProgressStage;
	fraction: number;
}

export interface BaseCloneOutcome {
	path: string;
	repoDir: string;
	repoDirExistedBeforeClone: boolean;
	baseDirExistedBeforeClone: boolean;
}

async function isGitCheckout(dir: string): Promise<boolean> {
	try {
		return (await stat(join(dir, '.git'))).isDirectory();
	} catch {
		return false;
	}
}

export function classifyCloneError(error: GitError): GitError {
	if (
		error.kind === 'git' &&
		(error.detail ?? error.message).toLowerCase().includes('already exists')
	) {
		return GitError.notARepo();
	}
	return error;
}

export interface CloneSeed {
	readonly folder: string;
	readonly branch: string;
}

export interface EnsureBaseCloneInput {
	repoPath: string;
	appDataRoot: string;
	githubToken: string | null | undefined;
	credentials: GitCredentialEnv;
	onProgress: (progress: Progress) => void;
	seed?: CloneSeed | null;
	blobless?: boolean;
}

const BLOBLESS_CLONE_ARGS = [
	'--filter=blob:none',
	'--config',
	'credential.https://github.com.helper=',
	'--config',
	'credential.https://github.com.helper=!gh auth git-credential',
] as const;

const SHARED_PACK_NOTE = 'shared with the folder Malini cloned this repository from\n';

export function ensureBaseCloneWithOutcome(input: EnsureBaseCloneInput): Promise<BaseCloneOutcome> {
	const projectId = deriveProjectId(input.repoPath);
	return withProjectLock(projectId, async () => {
		const { appDataRoot, onProgress } = input;
		const baseDir = repositoryBaseDir(appDataRoot, projectId);
		const repoDir = dirname(baseDir);

		onProgress({ stage: 'fetch', fraction: 0.05 });

		if (await isGitCheckout(baseDir)) {
			onProgress({ stage: 'done', fraction: 1.0 });
			return {
				path: baseDir,
				repoDir,
				repoDirExistedBeforeClone: true,
				baseDirExistedBeforeClone: true,
			};
		}

		const repoDirExistedBeforeClone = existsSync(repoDir);
		const baseDirExistedBeforeClone = existsSync(baseDir);
		await mkdir(repoDir, { recursive: true });

		const env = await input.credentials.prepare(normalizeGithubToken(input.githubToken));
		try {
			const seed = input.seed ? await usableSeed(input.seed.folder) : null;
			if (seed === null || !(await clonedFromSeed(seed, input, baseDir, env))) {
				await runGit(
					[
						...GH_CREDENTIAL_HELPER_CONFIG,
						'-c',
						DISABLED_GIT_HOOKS_CONFIG,
						'clone',
						'--progress',
						...(input.blobless ? BLOBLESS_CLONE_ARGS : []),
						input.repoPath,
						baseDir,
					],
					env,
				);
			}
		} catch (error) {
			await cleanupFailedBaseClone(
				repoDir,
				baseDir,
				repoDirExistedBeforeClone,
				baseDirExistedBeforeClone,
			);
			throw classifyCloneError(error instanceof GitError ? error : GitError.fromNodeError(error));
		}

		onProgress({ stage: 'fetch', fraction: 0.6 });
		onProgress({ stage: 'checkout', fraction: 0.85 });
		onProgress({ stage: 'done', fraction: 1.0 });

		return { path: baseDir, repoDir, repoDirExistedBeforeClone, baseDirExistedBeforeClone };
	});
}

export async function ensureBaseClone(input: EnsureBaseCloneInput): Promise<string> {
	return (await ensureBaseCloneWithOutcome(input)).path;
}

async function usableSeed(folder: string): Promise<string | null> {
	try {
		const commonDir = (
			await runGit(['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
		).trim();
		const shallow = (await runGit(['-C', folder, 'rev-parse', '--is-shallow-repository'])).trim();
		if (shallow !== 'false' || existsSync(join(commonDir, 'objects', 'info', 'alternates'))) {
			return null;
		}
		return (await hasConfig(folder, 'extensions.partialclone')) ? null : commonDir;
	} catch {
		return null;
	}
}

async function hasConfig(repository: string, key: string): Promise<boolean> {
	try {
		await runGit(['-C', repository, 'config', '--get', key]);
		return true;
	} catch {
		return false;
	}
}

async function clonedFromSeed(
	seed: string,
	input: EnsureBaseCloneInput,
	baseDir: string,
	env: GitEnv,
): Promise<boolean> {
	const branch = input.seed?.branch ?? '';
	try {
		await runGit([
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'clone',
			'--local',
			'--no-checkout',
			'--',
			seed,
			baseDir,
		]);
		await keepSharedPacks(baseDir);
		await runGit(['-C', baseDir, 'remote', 'set-url', 'origin', input.repoPath]);
	} catch (error) {
		return abandonSeed(seed, input.repoPath, baseDir, error);
	}
	await runGit(
		[
			'-C',
			baseDir,
			...GH_CREDENTIAL_HELPER_CONFIG,
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'fetch',
			'--prune',
			'--prune-tags',
			'origin',
		],
		env,
	);
	try {
		await runGit([
			'-C',
			baseDir,
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'checkout',
			'-q',
			'-B',
			branch,
			`refs/remotes/origin/${branch}`,
		]);
		for (const local of await branchList(baseDir)) {
			if (local !== branch) await runGit(['-C', baseDir, 'branch', '-D', local]);
		}
	} catch (error) {
		return abandonSeed(seed, input.repoPath, baseDir, error);
	}
	return true;
}

async function abandonSeed(
	seed: string,
	remote: string,
	baseDir: string,
	error: unknown,
): Promise<false> {
	console.warn(
		`malini: could not clone \`${remote}\` from \`${seed}\`, so it clones from the remote: ${describeError(error)}`,
	);
	await originalFs.rm(baseDir, { recursive: true, force: true });
	return false;
}

async function keepSharedPacks(repository: string): Promise<void> {
	const packs = join(repository, '.git', 'objects', 'pack');
	for (const name of await readdir(packs)) {
		if (!name.endsWith('.pack') || (await stat(join(packs, name))).nlink < 2) continue;
		await writeFile(join(packs, `${name.slice(0, -'.pack'.length)}.keep`), SHARED_PACK_NOTE);
	}
}

async function cleanupFailedBaseClone(
	repoDir: string,
	baseDir: string,
	repoDirExistedBeforeClone: boolean,
	baseDirExistedBeforeClone: boolean,
): Promise<void> {
	if (!repoDirExistedBeforeClone) {
		await originalFs.rm(repoDir, { recursive: true, force: true });
		return;
	}
	if (!baseDirExistedBeforeClone && existsSync(baseDir)) {
		await originalFs.rm(baseDir, { recursive: true, force: true });
	}
}

export async function cleanupCreatedBaseClone(outcome: BaseCloneOutcome): Promise<void> {
	if (outcome.baseDirExistedBeforeClone) return;
	if (!outcome.repoDirExistedBeforeClone) {
		await originalFs.rm(outcome.repoDir, { recursive: true, force: true });
		return;
	}
	if (existsSync(outcome.path)) {
		await originalFs.rm(outcome.path, { recursive: true, force: true });
	}
}
