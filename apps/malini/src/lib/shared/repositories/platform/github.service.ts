import type { CreateGithubRepositoryArgs } from '$contract/commands';
import type {
	ConnectedRepositoryDto,
	GithubRepositoryDto,
	RepositoryConnectionDto,
} from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { GhError, isGhError } from '$main/errors';
import { parseGhJson, runGh, type GhResult } from '$main/process/gh';
import { repositoryFullNameFromRemoteUrl } from '$shared/repositories/domain/repository-context';
import { field, requireNonEmptyString } from './args';
import { validateOwner } from './avatars.service';
import {
	findConnectedRepositoryByFullName,
	listConnectedRepositories,
	upsertConnectedRepository,
	type ConnectedRepository,
} from './connected-repositories.repository';
import { setRepositoryHidden } from './hidden-repositories.repository';
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

export type GhRunner = (
	args: readonly string[],
	options?: { cwd?: string; timeoutMs?: number },
) => Promise<GhResult>;

export const GITHUB_AUTH_CHECK_TIMEOUT_MS = 15_000;

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
		result = await run(['auth', 'status'], { timeoutMs: GITHUB_AUTH_CHECK_TIMEOUT_MS });
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
		const user = await run(['api', 'user', '--jq', '.login'], {
			timeoutMs: GITHUB_AUTH_CHECK_TIMEOUT_MS,
		});
		const trimmed = user.stdout.trim();
		if (user.code === 0 && trimmed.length > 0) login = trimmed;
	} catch {}
	return { authenticated: true, installed: true, login, host: 'github.com', message: null };
}

const RECENT_GITHUB_REPOSITORIES_PATH =
	'user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member';

// ponytail: first 100 repos by last push only; paginate once a search misses an older one
export async function listGithubRepositories(run: GhRunner): Promise<GithubRepositoryDto[]> {
	const result = await run(['api', RECENT_GITHUB_REPOSITORIES_PATH]);
	if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code);
	const parsed = parseGhJson<unknown>(result, 'list GitHub repositories');
	if (!Array.isArray(parsed)) {
		throw new GhError('failed', 'list GitHub repositories: gh returned a body that is not a list');
	}
	return parsed.flatMap(githubRepositoryDto);
}

function githubRepositoryDto(raw: unknown): GithubRepositoryDto[] {
	if (typeof raw !== 'object' || raw === null) return [];
	const fullName: unknown = Reflect.get(raw, 'full_name');
	const cloneUrl: unknown = Reflect.get(raw, 'clone_url');
	const description: unknown = Reflect.get(raw, 'description');
	const pushedAt: unknown = Reflect.get(raw, 'pushed_at');
	if (typeof fullName !== 'string' || typeof cloneUrl !== 'string') return [];
	const summary = typeof description === 'string' ? description.trim() : '';
	return [
		{
			fullName,
			cloneUrl,
			description: summary.length > 0 ? summary : null,
			private: Reflect.get(raw, 'private') === true,
			pushedAt: typeof pushedAt === 'string' ? pushedAt : null,
		},
	];
}

export async function listGithubOwners(run: GhRunner): Promise<string[]> {
	const [login, orgs] = await Promise.all([
		signedInLogin(run),
		run(['api', 'user/orgs?per_page=100']),
	]);
	if (orgs.code !== 0) throw GhError.fromStderr(orgs.stderr, orgs.code);
	const parsed = parseGhJson<unknown>(orgs, 'list GitHub organizations');
	if (!Array.isArray(parsed)) {
		throw new GhError('failed', 'list GitHub organizations: gh returned a body that is not a list');
	}
	return [login, ...parsed.flatMap(organizationLogin)];
}

function organizationLogin(raw: unknown): string[] {
	const login: unknown = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'login') : null;
	return typeof login === 'string' && login.length > 0 ? [login] : [];
}

const GITHUB_REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/u;

export function parseCreateGithubRepositoryArgs(args: unknown): CreateGithubRepositoryArgs {
	const owner = validateOwner(field(args, 'owner'));
	const name = requireNonEmptyString(args, 'name');
	if (!GITHUB_REPOSITORY_NAME.test(name) || /^\.+$/u.test(name)) {
		throw new Error(`invalid args: \`name\` is not a GitHub repository name: \`${name}\``);
	}
	const visibility = field(args, 'private');
	if (typeof visibility !== 'boolean') throw new Error('invalid args: `private` must be a boolean');
	return { owner, name, private: visibility };
}

export async function createGithubRepository(
	run: GhRunner,
	request: CreateGithubRepositoryArgs,
): Promise<GithubRepositoryDto> {
	const login = await signedInLogin(run);
	const path =
		request.owner.toLowerCase() === login.toLowerCase()
			? 'user/repos'
			: `orgs/${request.owner}/repos`;
	const result = await run([
		'api',
		'--method',
		'POST',
		path,
		'-f',
		`name=${request.name}`,
		'-F',
		`private=${request.private}`,
		'-F',
		'auto_init=true',
	]);
	if (result.code !== 0) throw creationFailure(result);
	const [created] = githubRepositoryDto(parseGhJson<unknown>(result, 'create a GitHub repository'));
	if (!created) {
		throw new GhError('failed', 'create a GitHub repository: gh returned no repository');
	}
	return created;
}

async function signedInLogin(run: GhRunner): Promise<string> {
	const result = await run(['api', 'user', '--jq', '.login']);
	if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code);
	const login = result.stdout.trim();
	if (login.length === 0) throw new GhError('failed', 'read your GitHub login: gh returned none');
	return login;
}

function creationFailure(result: GhResult): GhError {
	const failure = GhError.fromStderr(result.stderr, result.code);
	const reason = githubErrorReason(result.stdout);
	if (failure.kind !== 'failed' || reason === null) return failure;
	return new GhError('failed', `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`, {
		code: result.code,
		stderr: result.stderr,
	});
}

function githubErrorReason(body: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const errors: unknown = Reflect.get(parsed, 'errors');
	const first: unknown = Array.isArray(errors) ? errors[0] : null;
	const specific: unknown =
		typeof first === 'object' && first !== null ? Reflect.get(first, 'message') : null;
	const general: unknown = Reflect.get(parsed, 'message');
	if (typeof specific === 'string' && specific.length > 0) return specific;
	return typeof general === 'string' && general.length > 0 ? general : null;
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
): Promise<RepositoryConnectionDto> {
	const identity = await resolveIdentity(source, run);
	const existing = findConnectedRepositoryByFullName(db, identity.fullName);
	if (existing) {
		setRepositoryHidden(db, existing.id, false);
		return { repository: connectedRepositoryDto(existing), created: false };
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
	return { repository: connectedRepositoryDto(repository), created: true };
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

export async function githubRepositorySize(run: GhRunner, repoUrl: string): Promise<number | null> {
	const fullName = githubFullNameFromRemote(repoUrl);
	if (fullName === null) return null;
	try {
		const result = await run([
			'repo',
			'view',
			fullName,
			'--json',
			'diskUsage',
			'--jq',
			'.diskUsage',
		]);
		const kibibytes = Number(result.stdout.trim());
		return result.code === 0 && kibibytes > 0 ? kibibytes * 1024 : null;
	} catch {
		return null;
	}
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
