import type { ConnectedRepositoryDto } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { isGhError } from '$main/errors';
import { runGh, type GhResult } from '$main/process/gh';
import { repositoryFullNameFromRemoteUrl } from '$shared/repositories/domain/repository-context';
import {
	findConnectedRepositoryByFullName,
	listConnectedRepositories,
	upsertConnectedRepository,
	type ConnectedRepository,
} from './connected-repositories.repository';
import {
	folderName,
	githubFullNameFromRemote,
	isGitCheckout,
	readDefaultBranch,
	readOrigin,
	requireFolder,
	type ImportSource,
	type RepositoryIdentity,
} from './repository.service';

export type GhRunner = (args: readonly string[], options?: { cwd?: string }) => Promise<GhResult>;

export const defaultGhRunner: GhRunner = (args, options) => runGh(args, options);

export interface GitHubAuthStatusDto {
	authenticated: boolean;
	installed: boolean;
	login: string | null;
	host: string;
	message: string | null;
}

export async function githubAuthStatus(run: GhRunner): Promise<GitHubAuthStatusDto> {
	let result: GhResult;
	try {
		result = await run(['auth', 'status']);
	} catch (error) {
		if (isGhError(error, 'not-installed')) {
			return {
				authenticated: false,
				installed: false,
				login: null,
				host: 'github.com',
				message: error.message,
			};
		}
		throw error;
	}
	if (result.code !== 0) {
		return {
			authenticated: false,
			installed: true,
			login: null,
			host: 'github.com',
			message: firstLine(result.stderr) || firstLine(result.stdout) || 'Not signed in',
		};
	}
	let login: string | null = null;
	try {
		const user = await run(['api', 'user', '--jq', '.login']);
		const trimmed = user.stdout.trim();
		if (user.code === 0 && trimmed.length > 0) login = trimmed;
	} catch {}
	return { authenticated: true, installed: true, login, host: 'github.com', message: null };
}

export async function listClones(db: MaliniDatabase): Promise<ConnectedRepositoryDto[]> {
	const repositories = listConnectedRepositories(db);
	const refreshed = await Promise.all(
		repositories.map((repository) => refreshIdentity(repository)),
	);
	for (const repository of refreshed) {
		upsertConnectedRepository(db, repository);
	}
	return refreshed.map(connectedRepositoryDto);
}

export async function connectRepository(
	db: MaliniDatabase,
	run: GhRunner,
	source: ImportSource,
): Promise<ConnectedRepositoryDto> {
	const identity = await resolveIdentity(source, run);
	if (findConnectedRepositoryByFullName(db, identity.fullName)) {
		throw new Error(`Repository ${identity.fullName} is already connected`);
	}
	const repository: ConnectedRepository = {
		id: globalThis.crypto.randomUUID(),
		fullName: identity.fullName,
		defaultBranch: identity.defaultBranch,
		localPath: identity.localPath,
		remoteUrl: identity.remoteUrl,
		createdAt: nowIso8601(),
	};
	upsertConnectedRepository(db, repository);
	return connectedRepositoryDto(repository);
}

export function parseImportSource(value: unknown): ImportSource {
	if (typeof value !== 'object' || value === null) {
		throw new Error('invalid args: `source` must be an object');
	}
	const kind = Reflect.get(value, 'kind');
	if (kind === 'local-folder') {
		const path = Reflect.get(value, 'path');
		if (typeof path !== 'string' || path.length === 0) {
			throw new Error('invalid args: `source.path` must be a non-empty string');
		}
		return { kind, path };
	}
	if (kind === 'clone-url') {
		const url = Reflect.get(value, 'url');
		if (typeof url !== 'string' || url.length === 0) {
			throw new Error('invalid args: `source.url` must be a non-empty string');
		}
		return { kind, url };
	}
	throw new Error('invalid args: `source.kind` must be `local-folder` or `clone-url`');
}

async function resolveIdentity(source: ImportSource, run: GhRunner): Promise<RepositoryIdentity> {
	if (source.kind === 'local-folder') {
		const path = requireFolder(source.path ?? '');
		const isCheckout = isGitCheckout(path);
		const remoteUrl = isCheckout ? await readOrigin(path) : null;
		const fullName = remoteUrl ? repositoryFullNameFromRemoteUrl(remoteUrl) : null;
		return {
			fullName: fullName ?? folderName(path),
			defaultBranch: isCheckout ? await readDefaultBranch(path) : 'main',
			localPath: path,
			remoteUrl,
		};
	}
	const url = source.url ?? '';
	const githubFullName = githubFullNameFromRemote(url);
	return {
		fullName: repositoryFullNameFromRemoteUrl(url) ?? folderName(url),
		defaultBranch: githubFullName ? await remoteDefaultBranch(run, githubFullName) : 'main',
		localPath: null,
		remoteUrl: url,
	};
}

async function remoteDefaultBranch(run: GhRunner, fullName: string): Promise<string> {
	try {
		const result = await run([
			'repo',
			'view',
			fullName,
			'--json',
			'defaultBranchRef',
			'--jq',
			'.defaultBranchRef.name',
		]);
		if (result.code === 0) {
			const branch = result.stdout.trim();
			if (branch.length > 0) return branch;
		}
	} catch {}
	return 'main';
}

async function refreshIdentity(repository: ConnectedRepository): Promise<ConnectedRepository> {
	if (!repository.localPath || !isGitCheckout(repository.localPath)) {
		const fullName = repository.remoteUrl
			? repositoryFullNameFromRemoteUrl(repository.remoteUrl)
			: null;
		return { ...repository, fullName: fullName ?? repository.fullName };
	}
	const remoteUrl = await readOrigin(repository.localPath);
	const fullName = remoteUrl ? repositoryFullNameFromRemoteUrl(remoteUrl) : null;
	return {
		...repository,
		remoteUrl,
		fullName: fullName ?? repository.fullName,
		defaultBranch: await readDefaultBranch(repository.localPath, repository.defaultBranch),
	};
}

function connectedRepositoryDto(repository: ConnectedRepository): ConnectedRepositoryDto {
	return {
		id: repository.id,
		fullName: repository.fullName,
		defaultBranch: repository.defaultBranch,
		localPath: repository.localPath,
		remoteUrl: repository.remoteUrl,
		createdAt: repository.createdAt,
	};
}

function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? ''
	);
}
