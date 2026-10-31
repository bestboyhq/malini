import { createHash } from 'node:crypto';
import type { OwnPullRequestDto } from '$contract/repositories';
import { WORKSTREAM_BRANCH_PREFIX, isValidBranchName, validateWorkstreamId } from '$main/git/paths';
import { fastForwardCheckout, syncRemoteBase } from '$main/git/remote';
import { branchList } from '$main/git/worktrees';
import { runGit } from '$main/git/run';
import type { MaliniDatabase } from '$main/db/driver';
import { GhError } from '$main/errors';
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
import { listProjects } from './projects.repository';
import { projectDto } from './workstream-dto';
import { freeWorkstreamName, getWorkstream } from './workstreams.repository';
import { createWorkstream, restoreWorkstream, type WorkstreamsDeps } from './workstreams.service';

export interface OwnPullRequestsDeps {
	readonly workstreams: WorkstreamsDeps;
	readonly gh: GhRunner;
	readonly checkouts: CheckoutResolver;
	readonly guardCheckoutMove: CheckoutMoveGuard;
	readonly nameWorkstream?: (task: string) => Promise<string>;
}

interface OwnPullRequest {
	readonly number: number;
	readonly url: string;
	readonly draft: boolean;
	readonly updatedAt: string;
	readonly head: string;
	readonly title: string;
	readonly headSha: string;
	readonly baseBranch: string;
}

interface RepositoryProject {
	readonly id: string;
	readonly repoPath: string;
}

const OWN_PULL_REQUEST_FIELDS =
	'number,url,isDraft,updatedAt,title,headRefName,headRefOid,baseRefName,isCrossRepository';

const CONVENTIONAL_COMMIT_PREFIX = /^[a-z]+(?:\([^)]*\))?!?: +(?=\S)/u;

export async function listOwnPullRequests(
	deps: OwnPullRequestsDeps,
	repoId: string,
): Promise<OwnPullRequestDto[]> {
	const project = await repositoryProject(deps.workstreams.db, repoId);
	if (project === null) return [];
	return (await openPullRequests(deps.gh, project.repoPath)).map((pullRequest) => {
		const workstreamId = pullRequestWorkstreamId(project.id, pullRequest.head);
		const status = getWorkstream(deps.workstreams.db, workstreamId)?.status;
		return {
			number: pullRequest.number,
			title: pullRequest.title,
			url: pullRequest.url,
			draft: pullRequest.draft,
			updatedAt: pullRequest.updatedAt,
			head: pullRequest.head,
			workstreamId,
			workstream: status === 'active' || status === 'archived' ? status : null,
		};
	});
}

export async function continueOwnPullRequest(
	deps: OwnPullRequestsDeps,
	repoId: string,
	head: string,
): Promise<string> {
	const project = await repositoryProject(deps.workstreams.db, repoId);
	if (project === null) throw new Error('This repository has no checkout on this Mac yet.');
	const pullRequest = (await openPullRequests(deps.gh, project.repoPath)).find(
		(open) => open.head === head,
	);
	if (pullRequest === undefined) throw new Error(`You have no open pull request from ${head}.`);
	const workstreamId = pullRequestWorkstreamId(project.id, head);
	const workstream = getWorkstream(deps.workstreams.db, workstreamId);
	if (workstream === null) {
		await adopt(deps, project, workstreamId, pullRequest);
		return workstreamId;
	}
	if (workstream.status === 'archived') await restoreWorkstream(deps.workstreams, workstreamId);
	await fastForward(deps, workstreamId, workstream.branch, pullRequest).catch(() => {});
	return workstreamId;
}

async function repositoryProject(
	db: MaliniDatabase,
	repoId: string,
): Promise<RepositoryProject | null> {
	const projects = await Promise.all(listProjects(db).map(projectDto));
	const repository = mergeRepositories(
		listConnectedRepositories(db),
		localRepositoriesFromProjects(projects),
	).find(({ id }) => id === repoId);
	if (!repository) return null;
	const projectIds = new Set(repositoryProjectIds(repository, projects));
	return (
		projects.find((project) => projectIds.has(project.id) && project.repoPath.length > 0) ?? null
	);
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
	const number: unknown = Reflect.get(entry, 'number');
	const url: unknown = Reflect.get(entry, 'url');
	const updatedAt: unknown = Reflect.get(entry, 'updatedAt');
	const head: unknown = Reflect.get(entry, 'headRefName');
	const headSha: unknown = Reflect.get(entry, 'headRefOid');
	const baseBranch: unknown = Reflect.get(entry, 'baseRefName');
	const title: unknown = Reflect.get(entry, 'title');
	if (Reflect.get(entry, 'isCrossRepository') !== false) return null;
	if (typeof head !== 'string' || !isValidBranchName(head)) return null;
	if (typeof baseBranch !== 'string' || !isValidBranchName(baseBranch)) return null;
	if (typeof headSha !== 'string' || typeof title !== 'string') return null;
	if (typeof number !== 'number' || typeof url !== 'string' || typeof updatedAt !== 'string') {
		return null;
	}
	const draft = Reflect.get(entry, 'isDraft') === true;
	return { number, url, draft, updatedAt, head, title, headSha, baseBranch };
}

function pullRequestWorkstreamId(projectId: string, head: string): string {
	const malini = head.startsWith(WORKSTREAM_BRANCH_PREFIX)
		? head.slice(WORKSTREAM_BRANCH_PREFIX.length)
		: '';
	if (isValidWorkstreamId(malini)) return malini;
	return `pr-${createHash('sha256').update(`${projectId}\n${head}`).digest('hex').slice(0, 24)}`;
}

function isValidWorkstreamId(workstreamId: string): boolean {
	try {
		validateWorkstreamId(workstreamId);
		return true;
	} catch {
		return false;
	}
}

function titleName(title: string): string {
	const name = title.trim().replace(CONVENTIONAL_COMMIT_PREFIX, '');
	return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

async function workstreamName(deps: OwnPullRequestsDeps, title: string): Promise<string> {
	const suggested = await deps.nameWorkstream?.(title).catch(() => '');
	return suggested?.trim() || titleName(title);
}

async function openPullRequests(gh: GhRunner, repoPath: string): Promise<OwnPullRequest[]> {
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
	if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code);
	return ownPullRequests(parseGhJson<unknown>(result, 'gh pr list'));
}

async function adopt(
	deps: OwnPullRequestsDeps,
	project: RepositoryProject,
	workstreamId: string,
	pullRequest: OwnPullRequest,
): Promise<void> {
	const { db, credentials } = deps.workstreams;
	if ((await branchList(project.repoPath)).includes(pullRequest.head)) {
		throw new Error(`The branch ${pullRequest.head} is already checked out in this repository.`);
	}
	const startRef = await syncRemoteBase(project.repoPath, pullRequest.head, null, credentials);
	const name = await workstreamName(deps, pullRequest.title);
	await createWorkstream(deps.workstreams, {
		projectRepoPath: project.repoPath,
		workstreamId,
		branch: pullRequest.head,
		baseBranch: pullRequest.baseBranch,
		projectId: project.id,
		name: freeWorkstreamName(db, project.id, workstreamId, name),
		githubToken: null,
		startRef,
	});
}

async function fastForward(
	deps: OwnPullRequestsDeps,
	workstreamId: string,
	branch: string,
	pullRequest: OwnPullRequest,
): Promise<void> {
	if (branch !== pullRequest.head) return;
	const checkout = await deps.checkouts.resolveCheckout(workstreamId);
	if ((await runGit(['-C', checkout, 'rev-parse', 'HEAD'])).trim() === pullRequest.headSha) return;
	const remoteRef = await syncRemoteBase(checkout, branch, null, deps.workstreams.credentials);
	await deps.guardCheckoutMove(workstreamId, () => fastForwardCheckout(checkout, remoteRef));
}
