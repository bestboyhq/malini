import {
	applyCheckpointRestoreRedo,
	checkpointRestoreSeq,
	getCheckpoint,
	getCheckpointById,
	getCheckpointForRun,
	insertCheckpoint,
	insertUserBaseline,
	planCheckpointRestoreRedo,
	supersedeSessionFromCheckpoint,
	type AgentCheckpoint,
	type AgentUserBaseline,
	type CheckpointRestoreRedoResult,
	type RestoreSalvage,
	type SupersedeEmit,
} from '../checkpoints.repository';
import {
	getRunChange,
	getRunChangeForSession,
	insertRunChange,
	latestWorkstreamRunChangeCommit,
	nextRunCheckpointCommit,
	sessionChanges,
	previousRunSnapshotCommit,
	terminalRunsWithoutChanges,
	type AgentRunChange,
	type AgentRunChangePatch,
	type AgentSessionChangePatch,
	type AgentSessionChangeTurnPatch,
	type AgentSessionChanges,
} from '../changes.repository';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { getRun, workstreamHasOpenRun } from '../runs.repository';
import { agentSessionBelongsToWorkstream, conciseSessionTitle } from '../sessions.repository';
import type { EventBus } from '$main/events';
import { getWorkstream, type CheckoutResolver } from '$shared/repositories/repositories.platform';
import { DbInvariantError, GitError, isNotFoundError } from '$main/errors';
import { resolveBaseCommit } from '$main/git/diff';
import { runGit } from '$main/git/run';
import {
	CHECKPOINT_REF_NAMESPACE,
	composeSessionRunSnapshots,
	createCheckpointSnapshot,
	createRunChangeSnapshot,
	createSalvageSnapshot,
	createUserBaselineSnapshot,
	deleteCheckpointRef,
	deleteRunChangeRef,
	deleteUserBaselineRef,
	diffComposedSessionSnapshotPatch,
	diffWorktreeSnapshotPatch,
	diffWorktreeSnapshots,
	pinSnapshotRef,
	restoreCheckpointSnapshot,
	RUN_CHANGE_REF_NAMESPACE,
	snapshotCommitTree,
	undoSalvageRefName,
	USER_BASELINE_REF_NAMESPACE,
	worktreeSnapshotTree,
	type ComposedSessionSnapshot,
} from '$main/git/snapshots';
import type { Lease } from '../agent/lifecycle';
import type { IdSequence } from '../id-sequence';
import type { SnapshotRefNamespace } from '../snapshot-refs';
import {
	CHAT_RUN_CHANGES_CAPTURED_CHANNEL,
	type RunChangesCapturedPayload,
} from '$contract/events';

export type { RunChangesCapturedPayload };

export interface CheckpointContext {
	readonly db: MaliniDatabase;
	readonly appDataRoot: string;
	readonly resolver: CheckoutResolver;
	readonly ids: IdSequence;
	readonly snapshotRefs: SnapshotRefNamespace;
}

export interface RestoreCheckpointResult {
	sessionId: string;
	removedRunCount: number;
	restoreSeq: number;
}

export interface AgentSessionChangeScope {
	workstreamId: string;
}

export type CheckpointErrorKind = 'db' | 'git' | 'not-found' | 'run-active';

export class CheckpointError extends Error {
	readonly kind: CheckpointErrorKind;

	constructor(kind: CheckpointErrorKind, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'CheckpointError';
		this.kind = kind;
	}

	static db(cause: Error): CheckpointError {
		return new CheckpointError('db', `checkpoint database error: ${cause.message}`, cause);
	}

	static git(cause: Error, failed?: string): CheckpointError {
		const message = failed ? `${failed}: ${cause.message}` : cause.message;
		return new CheckpointError('git', message, cause);
	}

	static notFound(checkpointId: string): CheckpointError {
		return new CheckpointError('not-found', `checkpoint \`${checkpointId}\` not found`);
	}

	static runActive(): CheckpointError {
		return new CheckpointError(
			'run-active',
			'wait for the active run to finish before restoring a checkpoint',
		);
	}
}

export function isCheckpointError(error: unknown): error is CheckpointError {
	return error instanceof CheckpointError;
}

function asCheckpointError(error: unknown, failed: string | undefined): unknown {
	if (error instanceof DbInvariantError) return CheckpointError.db(error);
	if (error instanceof GitError) return CheckpointError.git(error, failed);
	if (failed && error instanceof CheckpointError && error.kind === 'git') {
		return CheckpointError.git(error, failed);
	}
	return error;
}

async function checkpointed<T>(body: () => Promise<T>, failed?: string): Promise<T> {
	try {
		return await body();
	} catch (error) {
		throw asCheckpointError(error, failed);
	}
}

const RESTORE_FAILED = "Couldn't restore the files from before this turn";
const REDO_FAILED = "Couldn't redo this turn";

function checkpointId(context: CheckpointContext): string {
	return context.ids.next('checkpoint');
}

function runChangeSnapshotId(context: CheckpointContext): string {
	return context.ids.next('run-change');
}

function userBaselineId(context: CheckpointContext): string {
	return context.ids.next('user-baseline');
}

function undoSalvageId(context: CheckpointContext): string {
	return context.ids.next('undo');
}

export const DIFFS_NEED_THE_FOLDER =
	"This chat's workstream folder is missing, so its diffs can't be opened.";

async function resolveCheckout(
	context: CheckpointContext,
	workstreamId: string,
	whenMissing?: string,
): Promise<string> {
	let worktree: string;
	try {
		worktree = await context.resolver.resolveCheckout(workstreamId);
	} catch (error) {
		const cause = error instanceof Error ? error : new Error(String(error));
		if (whenMissing && isNotFoundError(error)) throw new CheckpointError('git', whenMissing, cause);
		throw CheckpointError.git(cause);
	}
	await context.snapshotRefs.adopt(worktree);
	return worktree;
}

export function captureUserBaselineForRun(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
	runId: string,
): Promise<AgentUserBaseline | null> {
	return checkpointed(async () => {
		const { db } = context;
		const worktree = await resolveCheckout(context, workstreamId);
		const probeTree = await worktreeSnapshotTree(worktree);

		const previous = latestWorkstreamRunChangeCommit(db, workstreamId);
		if (previous !== null) {
			if ((await snapshotCommitTree(worktree, previous)) === probeTree) return null;
		} else if ((await snapshotCommitTree(worktree, 'HEAD')) === probeTree) {
			return null;
		}

		const id = userBaselineId(context);
		const gitRef = `${USER_BASELINE_REF_NAMESPACE}${workstreamId}/${id}`;
		const gitCommit = await createUserBaselineSnapshot(worktree, gitRef, id);
		const baseline: AgentUserBaseline = {
			id,
			workstreamId,
			sessionId,
			runId,
			gitRef,
			gitCommit,
			createdAt: nowIso8601(),
		};
		try {
			insertUserBaseline(db, baseline);
		} catch (error) {
			await deleteUserBaselineRef(worktree, gitRef).catch(() => undefined);
			throw error;
		}
		return baseline;
	});
}

export function captureCheckpointForRun(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
	runId: string,
): Promise<AgentCheckpoint> {
	return checkpointed(async () => {
		const id = checkpointId(context);
		const gitRef = `${CHECKPOINT_REF_NAMESPACE}${workstreamId}/${id}`;
		const worktree = await resolveCheckout(context, workstreamId);
		const gitCommit = await createCheckpointSnapshot(worktree, gitRef, id);
		const checkpoint: AgentCheckpoint = {
			id,
			workstreamId,
			sessionId,
			runId,
			userMessageSeq: null,
			gitRef,
			gitCommit,
			createdAt: nowIso8601(),
		};
		try {
			insertCheckpoint(context.db, checkpoint);
		} catch (error) {
			await deleteCheckpointRef(worktree, gitRef).catch(() => undefined);
			throw error;
		}
		return checkpoint;
	});
}

export function captureRunChangesForTerminal(
	context: CheckpointContext,
	runId: string,
	laterSnapshot: string | null = null,
): Promise<AgentRunChange | null> {
	return checkpointed(async () => {
		const { db } = context;
		const existing = getRunChange(db, runId);
		if (existing) return existing;
		const checkpoint = getCheckpointForRun(db, runId);
		if (!checkpoint) return null;
		const worktree = await resolveCheckout(context, checkpoint.workstreamId);
		const snapshotId = runChangeSnapshotId(context);
		const afterRef = `${RUN_CHANGE_REF_NAMESPACE}${checkpoint.workstreamId}/${snapshotId}`;
		let afterCommit: string;
		if (laterSnapshot === null) {
			afterCommit = await createRunChangeSnapshot(worktree, afterRef, snapshotId);
		} else {
			await pinSnapshotRef(worktree, afterRef, RUN_CHANGE_REF_NAMESPACE, laterSnapshot);
			afterCommit = laterSnapshot;
		}
		let snapshot;
		try {
			snapshot = await diffWorktreeSnapshots(worktree, checkpoint.gitCommit, afterCommit);
		} catch (error) {
			await deleteRunChangeRef(worktree, afterRef).catch(() => undefined);
			throw error;
		}
		const change: AgentRunChange = {
			runId,
			checkpointId: checkpoint.id,
			beforeCommit: checkpoint.gitCommit,
			afterCommit,
			afterRef,
			capturedAt: nowIso8601(),
			files: snapshot.files.map((file) => ({
				path: file.path,
				additions: file.additions,
				deletions: file.deletions,
				isBinary: file.isBinary,
			})),
		};
		try {
			insertRunChange(db, change);
		} catch (error) {
			await deleteRunChangeRef(worktree, afterRef).catch(() => undefined);
			throw error;
		}
		return change;
	});
}

export const SESSION_CHANGE_SCOPE_ERROR =
	'agent session does not belong to the requested workstream';

export function ensureAgentSessionChangeScope(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
): void {
	if (agentSessionBelongsToWorkstream(db, workstreamId, sessionId)) return;
	throw new Error(SESSION_CHANGE_SCOPE_ERROR);
}

interface SessionChangeProjection {
	readonly changes: AgentSessionChanges;
	readonly composed: ComposedSessionSnapshot | null;
}

async function projectSessionChanges(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
): Promise<SessionChangeProjection> {
	const changes = sessionChanges(context.db, sessionId);
	if (changes.runs.length === 0) return { changes, composed: null };
	try {
		const worktree = await resolveCheckout(context, workstreamId);
		const composed = await composeSessionRunSnapshots(
			worktree,
			changes.runs.map((run) => ({
				runId: run.runId,
				beforeCommit: run.beforeCommit,
				afterCommit: run.afterCommit,
				files: run.files,
			})),
		);
		const net = new Map(composed.files.map((file) => [file.path, file]));
		return {
			changes: {
				...changes,
				files: changes.files.flatMap((file) => {
					if (composed.stackedPaths.has(file.path)) return [file];
					const composedFile = net.get(file.path);
					return composedFile ? [{ ...composedFile, runIds: file.runIds }] : [];
				}),
			},
			composed,
		};
	} catch (error) {
		const log = folderMissing(error) ? console.warn : console.error;
		log(
			`agent: chat \`${sessionId}\` lists its per-run intervals because they could not be composed: ${describe(error)}`,
		);
		return { changes, composed: null };
	}
}

export async function sessionChangesForWorkstream(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
): Promise<AgentSessionChanges> {
	return (await projectSessionChanges(context, workstreamId, sessionId)).changes;
}

export async function sessionChangePatchForWorkstream(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
	path: string,
): Promise<AgentSessionChangePatch> {
	const { changes, composed } = await projectSessionChanges(context, workstreamId, sessionId);
	const file = changes.files.find((candidate) => candidate.path === path);
	const { beforeCommit, afterCommit } = changes;
	if (!file || beforeCommit === null || afterCommit === null) {
		throw new Error(`file \`${path}\` is not part of the changes for session \`${sessionId}\``);
	}
	const worktree = await resolveCheckout(context, workstreamId, DIFFS_NEED_THE_FOLDER);
	if (composed !== null && !composed.stackedPaths.has(path)) {
		const patch = await diffComposedSessionSnapshotPatch(
			worktree,
			composed.beforeTree,
			composed.afterTree,
			path,
		);
		return { sessionId, beforeCommit, afterCommit, patch, turns: [] };
	}
	const turns: AgentSessionChangeTurnPatch[] = [];
	for (const [index, run] of changes.runs.entries()) {
		const runFile = run.files.find((candidate) => candidate.path === path);
		if (!runFile) continue;
		turns.push({
			runId: run.runId,
			turn: index + 1,
			title: conciseSessionTitle(getRun(context.db, run.runId)?.prompt ?? ''),
			beforeCommit: run.beforeCommit,
			afterCommit: run.afterCommit,
			additions: runFile.additions,
			deletions: runFile.deletions,
			isBinary: runFile.isBinary,
			patch: await diffWorktreeSnapshotPatch(worktree, run.beforeCommit, run.afterCommit, path),
		});
	}
	return { sessionId, beforeCommit, afterCommit, patch: '', turns };
}

async function workstreamForkPoint(
	context: CheckpointContext,
	worktree: string,
	workstreamId: string,
): Promise<string> {
	const workstream = getWorkstream(context.db, workstreamId);
	if (!workstream) throw CheckpointError.notFound(workstreamId);
	const base = await resolveBaseCommit(worktree, workstream.baseBranch);
	return (await runGit(['-C', worktree, 'merge-base', 'HEAD', base])).trim();
}

async function recoverRunCheckpoint(
	context: CheckpointContext,
	workstreamId: string,
	runId: string,
): Promise<void> {
	const { db } = context;
	const agentRun = getRun(db, runId);
	if (!agentRun) throw CheckpointError.notFound(runId);
	const worktree = await resolveCheckout(context, workstreamId);
	const gitCommit =
		previousRunSnapshotCommit(db, workstreamId, runId) ??
		(await workstreamForkPoint(context, worktree, workstreamId));
	const id = checkpointId(context);
	const gitRef = `${CHECKPOINT_REF_NAMESPACE}${workstreamId}/${id}`;
	await pinSnapshotRef(worktree, gitRef, CHECKPOINT_REF_NAMESPACE, gitCommit);
	try {
		insertCheckpoint(db, {
			id,
			workstreamId,
			sessionId: agentRun.sessionId,
			runId,
			userMessageSeq: null,
			gitRef,
			gitCommit,
			createdAt: agentRun.startedAt,
		});
	} catch (error) {
		await deleteCheckpointRef(worktree, gitRef).catch(() => undefined);
		throw error;
	}
}

export async function recoverRunIntervals(
	context: CheckpointContext,
	workstreamId: string,
	runIds: readonly string[],
): Promise<void> {
	for (const runId of runIds) {
		try {
			await checkpointed(async () => {
				if (!getCheckpointForRun(context.db, runId)) {
					await recoverRunCheckpoint(context, workstreamId, runId);
				}
				const later = nextRunCheckpointCommit(context.db, workstreamId, runId);
				await captureRunChangesForTerminal(context, runId, later);
			});
		} catch (error) {
			const log = folderMissing(error) ? console.warn : console.error;
			log(`agent: could not recover the change interval of run \`${runId}\`: ${describe(error)}`);
		}
	}
}

export async function runChangePatchForWorkstream(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
	runId: string,
	path: string | null,
): Promise<AgentRunChangePatch> {
	const { db } = context;
	const change = getRunChangeForSession(db, sessionId, runId);
	if (!change) {
		throw new Error(`run change \`${runId}\` was not found in session \`${sessionId}\``);
	}
	if (path !== null && !change.files.some((file) => file.path === path)) {
		throw new Error(
			`file \`${path}\` is not attributed to run \`${runId}\` in session \`${sessionId}\``,
		);
	}
	const checkpoint = getCheckpointById(db, change.checkpointId);
	const matches =
		checkpoint !== null &&
		checkpoint.runId === runId &&
		checkpoint.sessionId === sessionId &&
		checkpoint.workstreamId === workstreamId &&
		checkpoint.gitCommit === change.beforeCommit;
	if (!matches) {
		throw new Error(`run change \`${runId}\` has no matching checkpoint`);
	}
	const worktree = await resolveCheckout(context, checkpoint.workstreamId, DIFFS_NEED_THE_FOLDER);
	const patch = await diffWorktreeSnapshotPatch(
		worktree,
		change.beforeCommit,
		change.afterCommit,
		path,
	);
	return {
		runId: change.runId,
		beforeCommit: change.beforeCommit,
		afterCommit: change.afterCommit,
		patch,
	};
}

async function salvageCheckoutBeforeRestore(
	context: CheckpointContext,
	worktree: string,
	workstreamId: string,
): Promise<RestoreSalvage | null> {
	const salvageId = undoSalvageId(context);
	const salvageRef = undoSalvageRefName(workstreamId, salvageId);
	try {
		const commit = await createSalvageSnapshot(worktree, salvageRef, salvageId);
		console.warn(
			`agent: salvaged \`${worktree}\` into \`${salvageRef}\` (${commit}) before restoring a checkpoint`,
		);
		return { ref: salvageRef, commit };
	} catch (error) {
		console.error(
			`agent: could not salvage \`${worktree}\` before restoring a checkpoint: ${describe(error)}`,
		);
		return null;
	}
}

export function restoreCheckpoint(
	context: CheckpointContext,
	workstreamId: string,
	checkpointId: string,
	emit: SupersedeEmit = () => {},
): Promise<RestoreCheckpointResult> {
	return checkpointed(async () => {
		const { db } = context;
		if (workstreamHasOpenRun(db, workstreamId)) throw CheckpointError.runActive();
		const checkpoint = getCheckpoint(db, workstreamId, checkpointId);
		if (!checkpoint) throw CheckpointError.notFound(checkpointId);
		checkpointRestoreSeq(checkpoint);
		const worktree = await resolveCheckout(context, workstreamId);

		const salvage = await salvageCheckoutBeforeRestore(context, worktree, workstreamId);
		await restoreCheckpointSnapshot(worktree, checkpoint.gitCommit);
		const superseded = supersedeSessionFromCheckpoint(db, checkpoint, salvage, emit);
		return {
			sessionId: superseded.sessionId,
			removedRunCount: superseded.obsoletedRunIds.length,
			restoreSeq: superseded.restoreSeq,
		};
	}, RESTORE_FAILED);
}

export function redoCheckpointRestore(
	context: CheckpointContext,
	workstreamId: string,
	sessionId: string,
	restoreSeq: number,
	emit: SupersedeEmit = () => {},
): Promise<CheckpointRestoreRedoResult> {
	return checkpointed(async () => {
		const plan = planCheckpointRestoreRedo(context.db, workstreamId, sessionId, restoreSeq);
		const worktree = await resolveCheckout(context, workstreamId);
		await salvageCheckoutBeforeRestore(context, worktree, workstreamId);
		await restoreCheckpointSnapshot(worktree, plan.salvageCommit);
		return applyCheckpointRestoreRedo(context.db, plan, emit);
	}, REDO_FAILED);
}

export interface RunIdentity {
	readonly workstreamId: string;
	readonly sessionId: string;
	readonly runId: string;
}

export async function captureRunStart(
	context: CheckpointContext,
	run: RunIdentity,
): Promise<string> {
	try {
		await captureUserBaselineForRun(context, run.workstreamId, run.sessionId, run.runId);
	} catch (error) {
		console.error(
			`agent: user baseline capture failed for workstream \`${run.workstreamId}\`: ${describe(error)}`,
		);
	}
	const checkpoint = await captureCheckpointForRun(
		context,
		run.workstreamId,
		run.sessionId,
		run.runId,
	);
	return checkpoint.id;
}

export async function captureRunFinish(
	context: CheckpointContext,
	emit: EventBus['emit'],
	runId: string,
): Promise<AgentRunChange | null> {
	let change: AgentRunChange | null;
	try {
		change = await captureRunChangesForTerminal(context, runId);
	} catch (error) {
		console.error(
			`agent: failed to capture terminal changes for run \`${runId}\`: ${describe(error)}`,
		);
		return null;
	}
	if (!change) return null;
	const run = getRun(context.db, runId);
	if (run) emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, { sessionId: run.sessionId, runId });
	return change;
}

function folderMissing(error: unknown): boolean {
	return isNotFoundError(error) || (error instanceof Error && isNotFoundError(error.cause));
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export interface RunChangeRecoveryLeases {
	acquireRunChangeRecovery(workstreamId: string): Lease;
}

export interface CheckpointService {
	readonly context: CheckpointContext;
	captureRunStart(run: RunIdentity): Promise<string>;
	captureRunFinish(runId: string): Promise<AgentRunChange | null>;
	restoreCheckpoint(workstreamId: string, checkpointId: string): Promise<RestoreCheckpointResult>;
	redoCheckpointRestore(
		workstreamId: string,
		sessionId: string,
		restoreSeq: number,
	): Promise<CheckpointRestoreRedoResult>;
	workstreamHasOpenRun(workstreamId: string): boolean;
	getSessionChanges(
		input: AgentSessionChangeScope & { sessionId: string },
	): Promise<AgentSessionChanges>;
	getSessionChangePatch(
		input: AgentSessionChangeScope & { sessionId: string; path: string },
	): Promise<AgentSessionChangePatch>;
	getRunChangePatch(
		input: AgentSessionChangeScope & { sessionId: string; runId: string; path?: string | null },
	): Promise<AgentRunChangePatch>;
}

export function createCheckpointService(
	context: CheckpointContext,
	events: EventBus,
	leases: RunChangeRecoveryLeases,
	emit: SupersedeEmit = () => {},
): CheckpointService {
	const { db } = context;
	const scoped = (scope: AgentSessionChangeScope, sessionId: string): void =>
		ensureAgentSessionChangeScope(db, scope.workstreamId, sessionId);
	const recoverWhenIdle = async (workstreamId: string, sessionId: string): Promise<void> => {
		const missing = terminalRunsWithoutChanges(db, sessionId);
		if (missing.length === 0) return;
		let lease: Lease;
		try {
			lease = leases.acquireRunChangeRecovery(workstreamId);
		} catch {
			return;
		}
		try {
			await recoverRunIntervals(context, workstreamId, missing);
		} finally {
			lease.release();
		}
	};
	return {
		context,
		captureRunStart: (run) => captureRunStart(context, run),
		captureRunFinish: (runId) =>
			captureRunFinish(context, (channel, payload) => events.emit(channel, payload), runId),
		restoreCheckpoint: (workstreamId, checkpointId) =>
			restoreCheckpoint(context, workstreamId, checkpointId, emit),
		redoCheckpointRestore: (workstreamId, sessionId, restoreSeq) =>
			redoCheckpointRestore(context, workstreamId, sessionId, restoreSeq, emit),
		workstreamHasOpenRun: (workstreamId) => workstreamHasOpenRun(db, workstreamId),
		getSessionChanges: async (input) => {
			scoped(input, input.sessionId);
			await recoverWhenIdle(input.workstreamId, input.sessionId);
			return sessionChangesForWorkstream(context, input.workstreamId, input.sessionId);
		},
		getSessionChangePatch: async (input) => {
			scoped(input, input.sessionId);
			return sessionChangePatchForWorkstream(
				context,
				input.workstreamId,
				input.sessionId,
				input.path,
			);
		},
		getRunChangePatch: async (input) => {
			scoped(input, input.sessionId);
			return runChangePatchForWorkstream(
				context,
				input.workstreamId,
				input.sessionId,
				input.runId,
				input.path ?? null,
			);
		},
	};
}
