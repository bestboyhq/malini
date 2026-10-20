import { describeError } from '$main/errors';
import {
	WORKSTREAM_BRANCH_PREFIX,
	validateBaseBranch,
	validateWorkstreamId,
	workstreamBranchName,
} from '$main/git/paths';
import { fastForwardCheckout, syncRemoteBase } from '$main/git/remote';
import { runGit } from '$main/git/run';
import type { MaliniDatabase } from '$main/db/driver';
import { parseGhJson } from '$main/process/gh';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryProjectIds,
} from '$shared/repositories/domain/repository-context';
import type { CheckoutMoveGuard } from './base-sync.service';
import type { CheckoutResolver } from './checkout-resolver';
import { listConnectedRepositories } from './connected-repositories.repository';
import type { GhRunner } from './github.service';
import { listHiddenRepositoryIds } from './hidden-repositories.repository';
import { listProjects, type Project } from './projects.repository';
import { projectDto } from './workstream-dto';
import { getWorkstream, workstreamWasDeleted } from './workstreams.repository';
import { createWorkstream, type WorkstreamsDeps } from './workstreams.service';

export interface OwnPullRequestsDeps {
	readonly workstreams: WorkstreamsDeps;
	readonly gh: GhRunner;
	readonly checkouts: CheckoutResolver;
	readonly guardCheckoutMove: CheckoutMoveGuard;
}

interface OwnPullRequest {
	readonly workstreamId: string;
	readonly title: string;
	readonly headSha: string;
	readonly baseBranch: string;
}

const OWN_PULL_REQUEST_FIELDS = 'title,headRefName,headRefOid,baseRefName,isCrossRepository';

const CONVENTIONAL_COMMIT_PREFIX = /^[a-z]+(?:\([^)]*\))?!?: +(?=\S)/u;

export async function syncOwnPullRequests(deps: OwnPullRequestsDeps): Promise<string[]> {
	const adopted: string[] = [];
	for (const project of await shownProjects(deps.workstreams.db)) {
		for (const pullRequest of await listOwnPullRequests(deps.gh, project.repoPath)) {
			const workstream = getWorkstream(deps.workstreams.db, pullRequest.workstreamId);
			if (workstream === null) {
				if (await adopt(deps, project, pullRequest)) adopted.push(pullRequest.workstreamId);
			} else if (workstream.status === 'active') {
				await fastForward(deps, workstream.id, workstream.branch, pullRequest).catch(() => {});
			}
		}
	}
	return adopted;
}

async function shownProjects(db: MaliniDatabase): Promise<Project[]> {
	const projects = await Promise.all(listProjects(db).map(projectDto));
	const hidden = new Set(listHiddenRepositoryIds(db));
	const hiddenProjectIds = new Set(
		mergeRepositories(listConnectedRepositories(db), localRepositoriesFromProjects(projects))
			.filter((repository) => hidden.has(repository.id))
			.flatMap((repository) => repositoryProjectIds(repository, projects)),
	);
	return projects.filter((project) => !hiddenProjectIds.has(project.id));
}

function ownPullRequests(listed: unknown): OwnPullRequest[] {
	if (!Array.isArray(listed)) return [];
	return listed.flatMap((entry: unknown) => {
		const pullRequest = ownPullRequest(entry);
		return pullRequest === null ? [] : [pullRequest];
	});
}

function ownPullRequest(entry: unknown): OwnPullRequest | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const head: unknown = Reflect.get(entry, 'headRefName');
	const headSha: unknown = Reflect.get(entry, 'headRefOid');
	const baseBranch: unknown = Reflect.get(entry, 'baseRefName');
	const title: unknown = Reflect.get(entry, 'title');
	if (Reflect.get(entry, 'isCrossRepository') !== false) return null;
	if (typeof head !== 'string' || !head.startsWith(WORKSTREAM_BRANCH_PREFIX)) return null;
	if (typeof headSha !== 'string' || typeof baseBranch !== 'string') return null;
	if (typeof title !== 'string') return null;
	const workstreamId = head.slice(WORKSTREAM_BRANCH_PREFIX.length);
	try {
		validateWorkstreamId(workstreamId);
		validateBaseBranch(baseBranch);
	} catch {
		return null;
	}
	return { workstreamId, title, headSha, baseBranch };
}

function workstreamName(title: string): string {
	const name = title.trim().replace(CONVENTIONAL_COMMIT_PREFIX, '');
	return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

async function listOwnPullRequests(gh: GhRunner, repoPath: string): Promise<OwnPullRequest[]> {
	try {
		const result = await gh(
			[
				'pr',
				'list',
				'--author',
				'@me',
				'--state',
				'open',
				'--limit',
				'100',
				'--json',
				OWN_PULL_REQUEST_FIELDS,
			],
			{ cwd: repoPath },
		);
		return result.code === 0 ? ownPullRequests(parseGhJson<unknown>(result, 'gh pr list')) : [];
	} catch {
		return [];
	}
}

async function adopt(
	deps: OwnPullRequestsDeps,
	project: Project,
	pullRequest: OwnPullRequest,
): Promise<boolean> {
	const { db, credentials } = deps.workstreams;
	if (workstreamWasDeleted(db, pullRequest.workstreamId)) return false;
	try {
		const branch = workstreamBranchName(pullRequest.workstreamId);
		await createWorkstream(deps.workstreams, {
			projectRepoPath: project.repoPath,
			workstreamId: pullRequest.workstreamId,
			baseBranch: pullRequest.baseBranch,
			projectId: project.id,
			name: workstreamName(pullRequest.title),
			githubToken: null,
			startRef: await syncRemoteBase(project.repoPath, branch, null, credentials),
		});
		return true;
	} catch (error) {
		console.error(
			`malini: could not open your pull request branch \`${pullRequest.workstreamId}\` as a workstream: ${describeError(error)}`,
		);
		return false;
	}
}

async function fastForward(
	deps: OwnPullRequestsDeps,
	workstreamId: string,
	branch: string,
	pullRequest: OwnPullRequest,
): Promise<void> {
	if (branch !== workstreamBranchName(workstreamId)) return;
	const checkout = await deps.checkouts.resolveCheckout(workstreamId);
	if ((await runGit(['-C', checkout, 'rev-parse', 'HEAD'])).trim() === pullRequest.headSha) return;
	const remoteRef = await syncRemoteBase(checkout, branch, null, deps.workstreams.credentials);
	await deps.guardCheckoutMove(workstreamId, () => fastForwardCheckout(checkout, remoteRef));
}
