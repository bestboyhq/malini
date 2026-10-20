import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { getProject, type Project } from './projects.repository';
import {
	getConnectedRepository,
	listConnectedRepositories,
	type ConnectedRepository,
} from './connected-repositories.repository';
import { deriveProjectId, localProjectId, repositoryBaseDir } from '$main/git/paths';
import { runGit } from '$main/git/run';
import type { ImportSource } from '$contract/repositories';
import { repositoryFullNameFromRemoteUrl } from '$shared/repositories/domain/repository-context';

export type { ImportSource };

export interface RepositoryIdentity {
	fullName: string;
	defaultBranch: string;
	localPath: string | null;
	remoteUrl: string | null;
}

export function githubFullNameFromRemote(remoteUrl: string): string | null {
	const url = remoteUrl.trim();
	if (url.length === 0) return null;
	const scp = /^[^@/]+@([^:/]+):(.+)$/u.exec(url);
	const candidate = scp ? { host: scp[1] ?? '', path: scp[2] ?? '' } : fromUrl(url);
	if (!candidate) return null;
	if (candidate.host.toLowerCase() !== 'github.com') return null;
	const parts = candidate.path
		.replace(/\.git$/u, '')
		.replace(/^\/+/u, '')
		.split('/')
		.filter((part) => part.length > 0);
	if (parts.length !== 2) return null;
	const [owner, name] = parts;
	if (!owner || !name) return null;
	return `${owner}/${name}`;
}

function fromUrl(url: string): { host: string; path: string } | null {
	try {
		const parsed = new URL(url);
		return { host: parsed.hostname, path: parsed.pathname };
	} catch {
		return null;
	}
}

export function folderName(path: string): string {
	const segments = path
		.replace(/[\\/]+$/u, '')
		.split(/[\\/]/u)
		.filter((segment) => segment.length > 0);
	return segments.at(-1) ?? 'repository';
}

export async function readOrigin(repoPath: string): Promise<string | null> {
	try {
		const url = (await runGit(['-C', repoPath, 'remote', 'get-url', 'origin'])).trim();
		return url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

export async function readDefaultBranch(repoPath: string, fallback = 'main'): Promise<string> {
	try {
		const head = (
			await runGit(['-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
		).trim();
		if (head.length > 0) return head.replace(/^origin\//u, '');
	} catch {}
	try {
		const branch = (await runGit(['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		if (branch.length > 0 && branch !== 'HEAD') return branch;
	} catch {}
	return fallback;
}

export function isGitCheckout(path: string): boolean {
	return existsSync(join(path, '.git'));
}

export function resolveRepositoryCheckout(
	db: MaliniDatabase,
	appDataRoot: string,
	repository: ConnectedRepository,
): string | null {
	if (repository.localPath && isGitCheckout(repository.localPath)) {
		return repository.localPath;
	}
	const projectId = managedProjectIdForRepository(repository);
	if (!projectId) return null;
	const project = getProject(db, projectId);
	if (project && project.repoPath.length > 0 && existsSync(project.repoPath)) {
		return project.repoPath;
	}
	const baseDir = repositoryBaseDir(appDataRoot, projectId);
	return existsSync(baseDir) ? baseDir : null;
}

export function managedProjectIdForRepository(repository: ConnectedRepository): string | null {
	const source = repository.remoteUrl ?? repository.localPath;
	if (!source) return null;
	return localProjectId(deriveProjectId(source));
}

export const LOCAL_REPOSITORY_ID_PREFIX = 'local:';

export async function resolveConnectedRepository(
	db: MaliniDatabase,
	repoId: string,
): Promise<ConnectedRepository | null> {
	const connected = getConnectedRepository(db, repoId);
	if (connected) return connected;

	const projectId = repoId.startsWith(LOCAL_REPOSITORY_ID_PREFIX)
		? repoId.slice(LOCAL_REPOSITORY_ID_PREFIX.length)
		: repoId;
	const project = getProject(db, projectId);
	if (!project) return null;

	const cloningInto = listConnectedRepositories(db).find(
		(repository) => managedProjectIdForRepository(repository) === project.id,
	);
	if (cloningInto) return cloningInto;

	return repositoryFromBaseClone(repoId, project);
}

async function repositoryFromBaseClone(
	repoId: string,
	project: Project,
): Promise<ConnectedRepository> {
	const remoteUrl = isGitCheckout(project.repoPath) ? await readOrigin(project.repoPath) : null;
	const fullName = remoteUrl ? repositoryFullNameFromRemoteUrl(remoteUrl) : null;
	return {
		id: repoId,
		fullName: fullName ?? project.name,
		defaultBranch: project.defaultBranch,
		localPath: project.repoPath,
		remoteUrl,
		createdAt: project.createdAt,
	};
}

export function requireFolder(path: string): string {
	if (!existsSync(path)) {
		throw new Error(`folder does not exist: ${path}`);
	}
	return path;
}
