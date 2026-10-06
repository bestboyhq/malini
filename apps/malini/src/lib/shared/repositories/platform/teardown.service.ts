import { existsSync } from 'node:fs';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
	adoptSnapshotRefNamespace,
	listWorkstreamSnapshotRefs,
	type WorkstreamSnapshotRefs,
} from '$lib/chat/chat.platform';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError, failureOutput, isErrnoException, isNotFoundError } from '$main/errors';
import { redactSensitiveText } from '$main/diagnostics/redaction';
import {
	NestedRepositoryWorkError,
	branchWorkIsKept,
	saveLocalOnlyWork,
	type ArchivedWork,
	type LocalWorkSource,
} from '$main/git/archived-work';
import {
	LEGACY_WORKSTREAM_BRANCH_PREFIXES,
	WORKSTREAM_BRANCH_PREFIX,
	acceptedWorkstreamBranchNames,
	validateWorkstreamId,
	workstreamPath,
	workstreamsRoot,
} from '$main/git/paths';
import { runGit } from '$main/git/run';
import {
	deleteCheckpointRef,
	deleteRunChangeRef,
	deleteUserBaselineRef,
} from '$main/git/snapshots';
import {
	deleteWorkstreamBranch,
	listWorktrees,
	owningRepositoryOfCheckout,
	pruneWorktreeAdministration,
	removeCheckoutDirResilient,
} from '$main/git/worktrees';
import { recordedBaseRepository, recordedCheckoutPath } from './checkout-resolver';
import { listProjects } from './projects.repository';
import { deleteWorkstream, getWorkstream, listWorkstreams } from './workstreams.repository';

const CHECKOUT_TRASH_DIR_NAME = '.trash';

const leftoversClearing = new Set<Promise<unknown>>();

export type TeardownGuard = <T>(workstreamId: string, teardown: () => Promise<T>) => Promise<T>;

export interface TeardownDeps {
	readonly db: MaliniDatabase;
	readonly appDataRoot: string;
	readonly guardTeardown?: TeardownGuard;
}

export interface RetiredCheckout {
	readonly worktreePath: string;
	readonly savedWork: ArchivedWork | null;
}

export async function teardownWorkstreamCheckout(
	deps: TeardownDeps,
	workstreamId: string,
): Promise<RetiredCheckout> {
	const { db, appDataRoot } = deps;
	let resolved: string | null;
	try {
		resolved = recordedCheckoutPath(db, appDataRoot, workstreamId);
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
		resolved = null;
	}
	const reportedPath = resolved ?? workstreamPath(appDataRoot, workstreamId);
	const guardTeardown = deps.guardTeardown;
	const guard = guardTeardown
		? <T>(body: () => Promise<T>) => guardTeardown(workstreamId, body)
		: <T>(body: () => Promise<T>) => body();

	let leftovers: TeardownLeftovers;
	try {
		leftovers = await guard(() => retireCheckout(deps, workstreamId, resolved));
	} catch (error) {
		throw removalFailure(error);
	}
	void trackLeftovers(clearLeftovers(leftovers));
	return { worktreePath: reportedPath, savedWork: leftovers.savedWork };
}

export async function archivedLeftoversCleared(): Promise<void> {
	await Promise.all(leftoversClearing);
}

function trackLeftovers<T>(work: Promise<T>): Promise<T> {
	const tracked = work.finally(() => leftoversClearing.delete(tracked));
	leftoversClearing.add(tracked);
	return tracked;
}

interface TeardownLeftovers {
	readonly workstreamId: string;
	readonly repository: string | null;
	readonly branch: string | null;
	readonly baseBranch: string | null;
	readonly snapshotRefs: WorkstreamSnapshotRefs | null;
	readonly trash: string | null;
	readonly savedWork: ArchivedWork | null;
}

async function retireCheckout(
	deps: TeardownDeps,
	workstreamId: string,
	checkout: string | null,
): Promise<TeardownLeftovers> {
	const { db, appDataRoot } = deps;
	const row = getWorkstream(db, workstreamId);
	const branch =
		row && acceptedWorkstreamBranchNames(workstreamId).includes(row.branch) ? row.branch : null;
	const repository =
		(checkout === null ? null : await owningRepositoryOfCheckout(checkout)) ??
		recordedBaseRepository(db, appDataRoot, workstreamId);
	const baseBranch = row?.baseBranch ?? null;
	const savedWork =
		repository !== null && branch !== null
			? await saveWorkBeforeRemoval(workstreamId, { repository, branch, baseBranch, checkout })
			: null;
	if (checkout === null) {
		deleteWorkstream(db, workstreamId);
		return {
			workstreamId,
			repository,
			branch,
			baseBranch,
			snapshotRefs: null,
			trash: null,
			savedWork,
		};
	}
	const snapshotRefs = listWorkstreamSnapshotRefs(db, workstreamId);
	const trash = await moveCheckoutToTrash(appDataRoot, workstreamId, checkout);
	try {
		deleteWorkstream(db, workstreamId);
	} catch (error) {
		await putCheckoutBack(workstreamId, trash, checkout, error);
		throw error;
	}
	return { workstreamId, repository, branch, baseBranch, snapshotRefs, trash, savedWork };
}

async function saveWorkBeforeRemoval(
	workstreamId: string,
	source: LocalWorkSource,
): Promise<ArchivedWork | null> {
	try {
		return await saveLocalOnlyWork(workstreamId, source);
	} catch (error) {
		if (error instanceof NestedRepositoryWorkError) {
			throw new WorkstreamRemovalError(
				'nested-work',
				`The nested repository ${error.path} has ${
					error.work === 'uncommitted' ? 'uncommitted changes' : 'commits that are on no remote'
				}, so nothing was removed`,
				error,
			);
		}
		throw new WorkstreamRemovalError(
			'save-failed',
			`Saving its local work failed${withReason(error)}, so nothing was removed`,
			error,
		);
	}
}

async function moveCheckoutToTrash(
	appDataRoot: string,
	workstreamId: string,
	checkout: string,
): Promise<string> {
	const trashRoot = checkoutTrashRoot(appDataRoot);
	const trash = join(trashRoot, `${workstreamId}-${Date.now()}`);
	try {
		await mkdir(trashRoot, { recursive: true });
		await rename(checkout, trash);
	} catch (error) {
		throw new WorkstreamRemovalError(
			'move-failed',
			`Its checkout could not be moved aside (${fileSystemReason(error)}), so nothing was removed`,
			error,
		);
	}
	return trash;
}

async function putCheckoutBack(
	workstreamId: string,
	trash: string,
	checkout: string,
	rowFailure: unknown,
): Promise<void> {
	try {
		await rename(trash, checkout);
	} catch (error) {
		console.error(
			`malini: workstream \`${workstreamId}\` was kept because its row could not be removed (${describeError(rowFailure)}), and its checkout could not be moved back from \`${trash}\` to \`${checkout}\`; the next start moves it back`,
		);
		throw new WorkstreamRemovalError(
			'stranded',
			`Its checkout was moved aside and could not be put back (${fileSystemReason(error)}); malini puts it back when it next starts`,
			error,
		);
	}
}

type RemovalFailureKind =
	'save-failed' | 'nested-work' | 'move-failed' | 'stranded' | 'run-active' | 'busy' | 'failed';

class WorkstreamRemovalError extends Error {
	override readonly name = 'WorkstreamRemovalError';
	readonly kind: RemovalFailureKind;
	readonly code: string | null;

	constructor(kind: RemovalFailureKind, message: string, cause: unknown) {
		super(message, { cause });
		this.kind = kind;
		this.code = isErrnoException(cause) ? (cause.code ?? null) : null;
	}
}

function removalFailure(error: unknown): WorkstreamRemovalError {
	if (error instanceof WorkstreamRemovalError) return error;
	const kind = typeof error === 'object' && error !== null ? Reflect.get(error, 'kind') : null;
	if (
		kind === 'workstream_teardown_blocked' ||
		/agent runs are active/u.test(describeError(error))
	) {
		return new WorkstreamRemovalError(
			'run-active',
			'An agent is still running in it, so nothing was removed',
			error,
		);
	}
	if (kind === 'workstream_teardown_pending') {
		return new WorkstreamRemovalError('busy', 'It is already being archived or deleted', error);
	}
	return new WorkstreamRemovalError(
		'failed',
		`Removing it failed${withReason(error)}, so nothing was removed`,
		error,
	);
}

const MAX_REASON_CHARS = 120;

function withReason(error: unknown): string {
	const reason = knownFailureReason(error) ?? firstLineOfCause(error);
	return reason === null ? '' : ` (${reason})`;
}

function knownFailureReason(error: unknown): string | null {
	const detail = failureOutput(error);
	if (/paths are ignored/iu.test(detail)) return 'git refused an ignored path';
	if (/permission denied|insufficient permission|EACCES/iu.test(detail)) return 'permission denied';
	if (/no space left/iu.test(detail)) return 'the disk is full';
	if (/\.lock\b.*exists|unable to create .*\.lock|cannot lock/iu.test(detail)) {
		return 'another git process holds a lock';
	}
	return null;
}

function firstLineOfCause(error: unknown): string | null {
	const line = failureOutput(error)
		.split('\n')
		.map((candidate) => candidate.trim().replace(/^(?:fatal|error|warning):\s*/iu, ''))
		.find((candidate) => candidate.length > 0 && !/^hint:/iu.test(candidate));
	if (line === undefined) return null;
	const redacted = [...redactSensitiveText(line)];
	return redacted.length > MAX_REASON_CHARS
		? `${redacted.slice(0, MAX_REASON_CHARS - 1).join('')}…`
		: redacted.join('');
}

function fileSystemReason(error: unknown): string {
	if (!isErrnoException(error)) return 'the file system refused';
	if (error.code === 'EACCES') return 'permission denied';
	if (error.code === 'EPERM') return 'operation not permitted';
	if (error.code === 'EBUSY') return 'it is in use';
	if (error.code === 'EXDEV') return 'the trash is on another disk';
	return error.code ?? 'the file system refused';
}

function errorWithStack(error: unknown): string {
	return error instanceof Error && error.stack ? error.stack : describeError(error);
}

async function clearLeftovers(leftovers: TeardownLeftovers): Promise<void> {
	const { workstreamId, repository, branch, baseBranch, snapshotRefs, trash, savedWork } =
		leftovers;
	if (repository !== null) {
		if (snapshotRefs !== null) {
			try {
				await deleteSnapshotRefs(repository, snapshotRefs);
			} catch (error) {
				console.error(
					`malini: could not delete the snapshot refs of workstream \`${workstreamId}\` in \`${repository}\`: ${errorWithStack(error)}`,
				);
			}
		}
		await pruneWorktreeAdministration(repository);
		if (branch !== null) {
			await deleteBranchIfItsWorkIsKept(repository, branch, baseBranch, savedWork?.ref ?? null);
		}
	}
	if (trash === null) return;
	const failure = await removeCheckoutDirResilient(trash);
	if (failure !== null) {
		console.error(
			`malini: the checkout of archived workstream \`${workstreamId}\` stays in the trash until the next start: ${failure}`,
		);
	}
}

export function checkoutTrashRoot(appDataRoot: string): string {
	return join(workstreamsRoot(appDataRoot), CHECKOUT_TRASH_DIR_NAME);
}

export function sweepArchivedLeftovers(
	db: MaliniDatabase,
	appDataRoot: string,
): Promise<readonly string[]> {
	return trackLeftovers(sweepLeftovers(db, appDataRoot));
}

async function sweepLeftovers(db: MaliniDatabase, appDataRoot: string): Promise<readonly string[]> {
	try {
		const projects = listProjects(db);
		const liveWorkstreamIds = new Set(listWorkstreams(db).map((workstream) => workstream.id));
		for (const project of projects) {
			if (!existsSync(join(project.repoPath, '.git'))) continue;
			await pruneWorktreeAdministration(project.repoPath);
			await sweepOrphanBranches(db, project.repoPath, project.defaultBranch);
		}
		return await sweepCheckoutTrash(appDataRoot, liveWorkstreamIds);
	} catch (error) {
		console.error(`malini: the sweep of archived leftovers stopped: ${errorWithStack(error)}`);
		return [];
	}
}

async function sweepOrphanBranches(
	db: MaliniDatabase,
	repository: string,
	baseBranch: string,
): Promise<void> {
	const live = new Set(listWorkstreams(db).map((workstream) => workstream.branch));
	let branches: string[];
	let checkedOut: Set<string>;
	try {
		branches = await workstreamBranches(repository);
		checkedOut = new Set(
			(await listWorktrees(repository)).flatMap((worktree) =>
				worktree.branch ? [worktree.branch.replace(/^refs\/heads\//u, '')] : [],
			),
		);
	} catch (error) {
		console.error(
			`malini: could not list the workstream branches in \`${repository}\`: ${errorWithStack(error)}`,
		);
		return;
	}
	for (const branch of branches) {
		if (live.has(branch) || checkedOut.has(branch)) continue;
		const workstreamId = branch.slice(branch.indexOf('/') + 1);
		let saved: ArchivedWork | null;
		try {
			saved = await saveLocalOnlyWork(workstreamId, {
				repository,
				branch,
				baseBranch,
				checkout: null,
			});
		} catch (error) {
			console.error(
				`malini: kept orphan branch \`${branch}\` in \`${repository}\` because its work could not be saved: ${errorWithStack(error)}`,
			);
			continue;
		}
		await deleteBranchIfItsWorkIsKept(repository, branch, baseBranch, saved?.ref ?? null);
	}
}

async function workstreamBranches(repository: string): Promise<string[]> {
	const listed = await runGit([
		'-C',
		repository,
		'for-each-ref',
		'--format=%(refname:short)',
		`refs/heads/${WORKSTREAM_BRANCH_PREFIX.replace(/\/$/u, '')}`,
		...LEGACY_WORKSTREAM_BRANCH_PREFIXES.map(
			(prefix) => `refs/heads/${prefix.replace(/\/$/u, '')}`,
		),
	]);
	return listed
		.split('\n')
		.map((line) => line.trim())
		.filter((branch) => {
			const id = branch.slice(branch.indexOf('/') + 1);
			return isValidWorkstreamId(id) && acceptedWorkstreamBranchNames(id).includes(branch);
		});
}

async function deleteBranchIfItsWorkIsKept(
	repository: string,
	branch: string,
	baseBranch: string | null,
	savedRef: string | null,
): Promise<void> {
	try {
		if (!(await branchWorkIsKept(repository, branch, baseBranch, savedRef))) {
			console.error(
				`malini: kept branch \`${branch}\` in \`${repository}\` because it has commits that neither ${
					savedRef ?? 'a saved ref'
				} nor ${baseBranch ?? 'the base branch'} contains`,
			);
			return;
		}
		await deleteWorkstreamBranch(repository, branch);
	} catch (error) {
		console.error(
			`malini: could not delete branch \`${branch}\` in \`${repository}\`; the next start retries: ${errorWithStack(error)}`,
		);
	}
}

async function trashEntries(appDataRoot: string): Promise<readonly string[]> {
	try {
		return await readdir(checkoutTrashRoot(appDataRoot));
	} catch {
		return [];
	}
}

export async function restoreStrandedCheckouts(
	db: MaliniDatabase,
	appDataRoot: string,
): Promise<void> {
	try {
		const liveCheckouts = new Map(
			listWorkstreams(db).map((workstream) => [workstream.id, workstream.path]),
		);
		for (const entry of await trashEntries(appDataRoot)) {
			const checkout = liveCheckouts.get(trashedWorkstreamId(entry));
			if (checkout === undefined) continue;
			await restoreStrandedCheckout(join(checkoutTrashRoot(appDataRoot), entry), checkout);
		}
	} catch (error) {
		console.error(`malini: the restore of stranded checkouts stopped: ${errorWithStack(error)}`);
	}
}

function trashedWorkstreamId(entry: string): string {
	return entry.replace(/-\d+$/u, '');
}

async function sweepCheckoutTrash(
	appDataRoot: string,
	liveWorkstreamIds: ReadonlySet<string>,
): Promise<readonly string[]> {
	const remaining: string[] = [];
	for (const entry of await trashEntries(appDataRoot)) {
		if (liveWorkstreamIds.has(trashedWorkstreamId(entry))) {
			remaining.push(entry);
			continue;
		}
		const failure = await removeCheckoutDirResilient(join(checkoutTrashRoot(appDataRoot), entry));
		if (failure === null) continue;
		console.error(`malini: could not empty the checkout trash: ${failure}`);
		remaining.push(entry);
	}
	return remaining;
}

async function restoreStrandedCheckout(trash: string, checkout: string): Promise<void> {
	if (existsSync(checkout)) {
		console.error(
			`malini: kept \`${trash}\` in the checkout trash because its workstream is live and already has a checkout at \`${checkout}\``,
		);
		return;
	}
	try {
		await rename(trash, checkout);
		console.warn(`malini: moved the checkout of a live workstream back to \`${checkout}\``);
	} catch (error) {
		console.error(
			`malini: could not move \`${trash}\` back to its live workstream at \`${checkout}\`: ${errorWithStack(error)}`,
		);
	}
}

export async function deleteWorkstreamSnapshotRefs(
	db: MaliniDatabase,
	worktreePath: string,
	workstreamId: string,
): Promise<void> {
	await deleteSnapshotRefs(worktreePath, listWorkstreamSnapshotRefs(db, workstreamId));
}

async function deleteSnapshotRefs(repository: string, refs: WorkstreamSnapshotRefs): Promise<void> {
	await adoptSnapshotRefNamespace(repository);
	for (const ref of refs.checkpointRefs) await deleteCheckpointRef(repository, ref);
	for (const ref of refs.runChangeRefs) await deleteRunChangeRef(repository, ref);
	for (const ref of refs.userBaselineRefs) await deleteUserBaselineRef(repository, ref);
}

function isValidWorkstreamId(workstreamId: string): boolean {
	try {
		validateWorkstreamId(workstreamId);
		return true;
	} catch {
		return false;
	}
}
