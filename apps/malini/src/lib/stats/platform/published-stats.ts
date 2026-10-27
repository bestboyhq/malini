import type { PublicRepository, PublishedStats } from '$contract/stats';
import type { MaliniDatabase } from '$main/db/driver';
import { runGh } from '$main/process/gh';
import {
	listFinishedRunToolCalls,
	listRunChangedFiles,
	listRunFacts,
} from '$lib/chat/chat.platform';
import {
	githubFullNameFromRemote,
	listArchivedWorkstreams,
	listConnectedRepositories,
	listWorkstreams,
	managedProjectIdForRepository,
} from '$shared/repositories/repositories.platform';
import { publishedStats, statsCutoff, type StatsRepository } from '../domain/published-stats';

export type RepositoryVisibility = (fullName: string) => Promise<boolean>;

export type GitHubIdentity = Readonly<{ login: string; name: string | null }>;

type GhRun = typeof runGh;

const VISIBILITY_FRESH_MS = 60 * 60_000;

export const NOT_PUBLIC: RepositoryVisibility = () => Promise.resolve(false);

export async function readPublishedStats(
	db: MaliniDatabase,
	now: Date,
	picked: readonly string[],
	isPublic: RepositoryVisibility,
): Promise<PublishedStats | null> {
	const cutoff = statsCutoff(now);
	const before = cutoff.toISOString();
	const runs = listRunFacts(db, before);
	const finishedToolCalls = listFinishedRunToolCalls(db, before);
	const changedFiles = listRunChangedFiles(db, before).map((file) => ({
		...file,
		repository: file.projectId,
	}));
	const workstreams = [
		...listWorkstreams(db).map((workstream) => ({ ...workstream, mergedAt: null })),
		...listArchivedWorkstreams(db).map((workstream) => ({
			...workstream,
			mergedAt: workstream.mergedPullRequest ? workstream.archivedAt : null,
		})),
	].filter((workstream) => workstream.scope === null);
	const repositories = await repositoryVisibility(
		db,
		runs.filter((run) => !run.lead).map((run) => run.projectId),
		isPublic,
	);
	return publishedStats(
		{
			runs: runs.map((run) => ({ ...run, repository: run.lead ? null : run.projectId })),
			finishedToolCalls,
			changedFiles,
			workstreams,
			repositories,
			picked,
		},
		cutoff,
	);
}

export async function readPublicRepositories(
	db: MaliniDatabase,
	now: Date,
	isPublic: RepositoryVisibility,
): Promise<PublicRepository[]> {
	const runs = listRunFacts(db, now.toISOString()).filter((run) => !run.lead);
	const repositories = await repositoryVisibility(
		db,
		runs.map((run) => run.projectId),
		isPublic,
	);
	const runsByName = new Map<string, number>();
	for (const run of runs) {
		const repository = repositories.get(run.projectId);
		if (repository?.public) {
			runsByName.set(repository.fullName, (runsByName.get(repository.fullName) ?? 0) + 1);
		}
	}
	return [...runsByName]
		.map(([fullName, count]) => ({ fullName, runs: count }))
		.sort((left, right) => right.runs - left.runs || left.fullName.localeCompare(right.fullName));
}

export function createRepositoryVisibility(run: GhRun = runGh): RepositoryVisibility {
	const known = new Map<string, Readonly<{ public: boolean; checkedAt: number }>>();
	return async (fullName) => {
		const key = fullName.toLowerCase();
		const cached = known.get(key);
		if (cached && Date.now() - cached.checkedAt < VISIBILITY_FRESH_MS) return cached.public;
		try {
			const result = await run(['api', `repos/${fullName}`, '--jq', '.visibility']);
			const isPublic = result.code === 0 && result.stdout.trim() === 'public';
			if (result.code === 0) known.set(key, { public: isPublic, checkedAt: Date.now() });
			return isPublic;
		} catch {
			return false;
		}
	};
}

export function createGitHubIdentity(run: GhRun = runGh): () => Promise<GitHubIdentity | null> {
	let known: GitHubIdentity | null = null;
	return async () => {
		if (known) return known;
		try {
			const result = await run(['api', 'user', '--jq', '.login + "\\t" + (.name // "")']);
			const [login = '', name = ''] = result.stdout.trim().split('\t');
			if (result.code !== 0 || !/^[A-Za-z0-9-]{1,39}$/u.test(login)) return null;
			known = { login, name: name.trim() || null };
			return known;
		} catch {
			return null;
		}
	};
}

async function repositoryVisibility(
	db: MaliniDatabase,
	projectIds: readonly string[],
	isPublic: RepositoryVisibility,
): Promise<Map<string, StatsRepository>> {
	const names = githubRepositoryNames(db);
	const repositories = new Map<string, StatsRepository>();
	await Promise.all(
		[...new Set(projectIds)].map(async (projectId) => {
			const fullName = names.get(projectId);
			if (fullName) repositories.set(projectId, { fullName, public: await isPublic(fullName) });
		}),
	);
	return repositories;
}

function githubRepositoryNames(db: MaliniDatabase): Map<string, string> {
	const names = new Map<string, string>();
	for (const repository of listConnectedRepositories(db)) {
		const projectId = managedProjectIdForRepository(repository);
		const fullName = repository.remoteUrl ? githubFullNameFromRemote(repository.remoteUrl) : null;
		if (projectId && fullName) names.set(projectId, fullName);
	}
	return names;
}
