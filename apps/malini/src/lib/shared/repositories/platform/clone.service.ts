import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	GH_CREDENTIAL_HELPER_CONFIG,
	normalizeGithubToken,
	type GitCredentialEnv,
} from '$main/git/credentials';
import { deriveProjectId, repositoryBaseDir } from '$main/git/paths';
import { GitError } from '$main/errors';
import { DISABLED_GIT_HOOKS_CONFIG, runGit } from '$main/git/run';
import { withProjectLock } from '$main/git/worktrees';

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

export interface EnsureBaseCloneInput {
	repoPath: string;
	appDataRoot: string;
	githubToken: string | null | undefined;
	credentials: GitCredentialEnv;
	onProgress: (progress: Progress) => void;
}

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
			await runGit(
				[
					...GH_CREDENTIAL_HELPER_CONFIG,
					'-c',
					DISABLED_GIT_HOOKS_CONFIG,
					'clone',
					'--progress',
					input.repoPath,
					baseDir,
				],
				env,
			);
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

async function cleanupFailedBaseClone(
	repoDir: string,
	baseDir: string,
	repoDirExistedBeforeClone: boolean,
	baseDirExistedBeforeClone: boolean,
): Promise<void> {
	if (!repoDirExistedBeforeClone) {
		await rm(repoDir, { recursive: true, force: true });
		return;
	}
	if (!baseDirExistedBeforeClone && existsSync(baseDir)) {
		await rm(baseDir, { recursive: true, force: true });
	}
}

export async function cleanupCreatedBaseClone(outcome: BaseCloneOutcome): Promise<void> {
	if (outcome.baseDirExistedBeforeClone) return;
	if (!outcome.repoDirExistedBeforeClone) {
		await rm(outcome.repoDir, { recursive: true, force: true });
		return;
	}
	if (existsSync(outcome.path)) {
		await rm(outcome.path, { recursive: true, force: true });
	}
}
