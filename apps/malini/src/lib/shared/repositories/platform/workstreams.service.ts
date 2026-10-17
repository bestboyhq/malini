import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
	REPOSITORIES_CLONE_PROGRESS_CHANNEL,
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
	type CloneProgressPayload,
	type WorktreeAddedPayload,
	type WorktreeRemovedPayload,
} from '$contract/events';
import type {
	ArchivedWorkstreamDto,
	GitProjectRecord,
	Workstream,
	WorkstreamRetirementReceipt,
} from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { EventBus } from '$main/events';
import { releaseRestoredWork, restoreArchivedWork } from '$main/git/archived-work';
import type { GitCredentialEnv } from '$main/git/credentials';
import { ensureAppManagedGitExcludes } from '$main/git/excludes';
import {
	WORKSTREAM_BRANCH_PREFIX,
	deriveProjectId,
	localProjectId,
	workstreamBranchName,
	workstreamPath,
	workstreamsRoot,
} from '$main/git/paths';
import {
	addWorktreeWithRollback,
	branchList,
	cleanupFailedWorkstream,
	cleanupFailedWorktreeAdd,
} from '$main/git/worktrees';
import {
	connectedRepositoryContexts,
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryProjectIds,
	type ConnectedRepositoryContext,
} from '$shared/repositories/domain/repository-context';
import type { Repository } from '$shared/repositories/domain/repository';
import { UNOBSERVED_WORKSTREAM_CHECKOUT } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import type { WorkstreamBaseSync } from './base-sync.service';
import { cleanupCreatedBaseClone, ensureBaseCloneWithOutcome } from './clone.service';
import {
	deleteConnectedRepository,
	listConnectedRepositories,
} from './connected-repositories.repository';
import {
	deleteProjectWithoutWorkstreams,
	getProject,
	listProjects,
	upsertProject,
} from './projects.repository';
import { recordedBaseRepository } from './checkout-resolver';
import { restoreKeptFolders } from './kept-folders';
import {
	teardownWorkstreamCheckout,
	type TeardownGuard,
	type WorkstreamRetirement,
} from './teardown.service';
import { setRepositoryHidden } from './hidden-repositories.repository';
import { projectDto } from './workstream-dto';
import {
	getArchivedWorkstream,
	getWorkstream,
	listArchivedWorkstreams,
	listWorkstreams,
	renameWorkstream,
	restoreWorkstreamRecord,
	upsertWorkstreamBundle,
} from './workstreams.repository';

export interface WorkstreamsDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly appDataRoot: string;
	readonly credentials: GitCredentialEnv;
	readonly baseSync: WorkstreamBaseSync;
	readonly guardTeardown?: TeardownGuard;
}

export interface CreateRepositoryInput {
	readonly repoUrl: string;
	readonly githubToken: string | null;
}

export interface CreateWorkstreamInput {
	readonly projectRepoPath: string;
	readonly workstreamId: string;
	readonly baseBranch: string;
	readonly projectId: string;
	readonly name: string;
	readonly githubToken: string | null;
}

export async function createRepository(
	deps: WorkstreamsDeps,
	input: CreateRepositoryInput,
): Promise<string> {
	const { db, events, appDataRoot, credentials } = deps;
	const repoId = deriveProjectId(input.repoUrl);
	let lastEmittedAt = Date.now() - 100;
	const outcome = await ensureBaseCloneWithOutcome({
		repoPath: input.repoUrl,
		appDataRoot,
		githubToken: input.githubToken,
		credentials,
		onProgress: (progress) => {
			const now = Date.now();
			const terminal = progress.fraction >= 1;
			if (!terminal && now - lastEmittedAt < 100) return;
			lastEmittedAt = now;
			const payload: CloneProgressPayload = {
				repo_id: repoId,
				stage: progress.stage,
				fraction: progress.fraction,
			};
			events.emit(REPOSITORIES_CLONE_PROGRESS_CHANNEL, payload);
		},
	});
	try {
		upsertProject(db, {
			id: localProjectId(repoId),
			name: repoId,
			repoPath: outcome.path,
			defaultBranch: 'main',
			createdAt: nowIso8601(),
		});
	} catch (error) {
		await cleanupCreatedBaseClone(outcome);
		throw new Error(describeError(error));
	}
	return outcome.path;
}

export async function createWorkstream(
	deps: WorkstreamsDeps,
	input: CreateWorkstreamInput,
): Promise<string> {
	const { db, events, appDataRoot, baseSync } = deps;
	const { projectRepoPath, workstreamId, baseBranch, projectId, name } = input;

	await mkdir(workstreamsRoot(appDataRoot), { recursive: true });
	const worktreePath = workstreamPath(appDataRoot, workstreamId);
	const branch = workstreamBranchName(workstreamId);
	const start = await baseSync.startRef(projectRepoPath, baseBranch, input.githubToken);
	await addWorktreeWithRollback(projectRepoPath, worktreePath, branch, start.ref);

	try {
		await ensureAppManagedGitExcludes(worktreePath);
	} catch (error) {
		console.error(
			`malini: could not install the repository exclude rule for \`${workstreamId}\`: ${describeError(error)}`,
		);
	}

	const now = nowIso8601();
	const project: GitProjectRecord = {
		id: projectId,
		name: projectId,
		repoPath: projectRepoPath,
		defaultBranch: baseBranch,
		createdAt: now,
	};
	const workstream: Workstream = {
		id: workstreamId,
		projectId,
		name,
		path: worktreePath,
		branch,
		baseBranch,
		status: 'active',
		createdAt: now,
	};
	try {
		upsertWorkstreamBundle(db, project, workstream);
	} catch (error) {
		const message = describeError(error);
		const cleanup = await cleanupFailedWorkstream(projectRepoPath, worktreePath, branch);
		throw new Error(
			cleanup === null ? message : `${message}; the checkout could not be rolled back: ${cleanup}`,
		);
	}

	if (start.fetched) baseSync.rememberFetchedAtCreation(workstreamId);
	const payload: WorktreeAddedPayload = { workstreamId, project, workstream };
	events.emit(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, payload);
	return worktreePath;
}

export async function retireWorkstream(
	deps: WorkstreamsDeps,
	workstreamId: string,
	reason: WorkstreamRetirement,
): Promise<WorkstreamRetirementReceipt> {
	const { worktreePath, savedWork } = await teardownWorkstreamCheckout(
		{
			db: deps.db,
			appDataRoot: deps.appDataRoot,
			...(deps.guardTeardown ? { guardTeardown: deps.guardTeardown } : {}),
		},
		workstreamId,
		reason,
	);
	const payload: WorktreeRemovedPayload = {
		workstreamId,
		worktreePath,
		...(reason === 'archived' ? { archived: true } : { deleted: true }),
	};
	deps.events.emit(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, payload);
	return {
		savedWork: savedWork
			? { ref: savedWork.ref, uncommitted: savedWork.uncommitted, commits: savedWork.commits }
			: null,
	};
}

export async function restoreWorkstream(
	deps: WorkstreamsDeps,
	workstreamId: string,
): Promise<void> {
	const { db, events, appDataRoot, baseSync } = deps;
	const archived = getArchivedWorkstream(db, workstreamId);
	if (archived === null) throw new Error(`Not an archived workstream: ${workstreamId}`);
	const project = getProject(db, archived.projectId);
	const repository = recordedBaseRepository(db, appDataRoot, workstreamId);
	if (project === null || repository === null) {
		throw new Error('Its repository is no longer on this Mac');
	}
	const checkout = workstreamPath(appDataRoot, workstreamId);
	const branch = archived.branch.startsWith(WORKSTREAM_BRANCH_PREFIX)
		? archived.branch
		: workstreamBranchName(workstreamId);
	const checkoutExisted = existsSync(checkout);
	const branchExisted = (await branchList(repository)).includes(branch);
	await mkdir(workstreamsRoot(appDataRoot), { recursive: true });
	try {
		await restoreArchivedWork({
			repository,
			checkout,
			branch,
			savedRef: archived.archivedRef,
			baseStart: async () => (await baseSync.startRef(repository, archived.baseBranch, null)).ref,
		});
		restoreWorkstreamRecord(db, workstreamId, checkout, branch);
	} catch (error) {
		const cleanup = await cleanupFailedWorktreeAdd(
			repository,
			checkout,
			branch,
			checkoutExisted,
			branchExisted,
		);
		const message = describeError(error);
		throw new Error(
			cleanup === null ? message : `${message}; the checkout could not be rolled back: ${cleanup}`,
		);
	}
	await settleRestoredCheckout(workstreamId, repository, checkout, branch, archived.archivedRef);
	await restoreKeptFolders(appDataRoot, workstreamId, checkout).catch((error: unknown) =>
		console.error(
			`malini: restored workstream \`${workstreamId}\` without the folders it kept when archived; the next restore retries: ${describeError(error)}`,
		),
	);
	renameWorkstream(db, workstreamId, archived.name);
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null) throw new Error(`Unknown workstream: ${workstreamId}`);
	const payload: WorktreeAddedPayload = { workstreamId, project, workstream };
	events.emit(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, payload);
}

async function settleRestoredCheckout(
	workstreamId: string,
	repository: string,
	checkout: string,
	branch: string,
	savedRef: string | null,
): Promise<void> {
	try {
		await ensureAppManagedGitExcludes(checkout);
		if (savedRef !== null) await releaseRestoredWork(repository, branch, savedRef);
	} catch (error) {
		console.error(
			`malini: restored workstream \`${workstreamId}\` but could not tidy its checkout: ${describeError(error)}`,
		);
	}
}

export function listArchived(deps: WorkstreamsDeps): ArchivedWorkstreamDto[] {
	return listArchivedWorkstreams(deps.db).map(
		({ id, projectId, name, baseBranch, archivedAt }) => ({
			id,
			projectId,
			name,
			baseBranch,
			archivedAt,
		}),
	);
}

export async function removeRepository(deps: WorkstreamsDeps, repositoryId: string): Promise<void> {
	const { db } = deps;
	const projects = await Promise.all(listProjects(db).map(projectDto));
	const repositories = mergeRepositories(
		listConnectedRepositories(db),
		localRepositoriesFromProjects(projects),
	);
	const repository = repositories.find((candidate) => candidate.id === repositoryId);
	if (!repository) throw new Error(`Unknown repository: ${repositoryId}`);
	for (const workstream of repositoryWorkstreams(db, repositories, repository)) {
		try {
			await retireWorkstream(deps, workstream.id, 'deleted');
		} catch (error) {
			throw new Error(
				`${displayWorkstreamName(workstream, repository.fullName)}: ${describeError(error)}`,
				{ cause: error },
			);
		}
	}
	const projectIds = repositoryProjectIds(repository, projects);
	db.transaction(() => {
		deleteConnectedRepository(db, repository.id);
		setRepositoryHidden(db, repository.id, false);
		for (const projectId of projectIds) deleteProjectWithoutWorkstreams(db, projectId);
	});
}

function repositoryWorkstreams(
	db: MaliniDatabase,
	repositories: readonly Repository[],
	repository: Repository,
): ConnectedRepositoryContext['workstreams'] {
	const workstreams = [...listWorkstreams(db), ...listArchivedWorkstreams(db)].map((row) => ({
		...row,
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
	}));
	return (
		connectedRepositoryContexts({ repositories, workstreams }).find(
			(context) => context.repo.id === repository.id,
		)?.workstreams ?? []
	);
}
