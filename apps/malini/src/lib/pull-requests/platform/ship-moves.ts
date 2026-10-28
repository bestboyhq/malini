import {
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type { ShippingJobBuiltin } from '$contract/jobs';
import type { WorktreeStatus } from '$contract/repositories';
import { isRecord } from '$main/db/rows';
import { describeError, isGhError, isGitError } from '$main/errors';
import { workstreamShipContext } from '$lib/chat/chat.platform';
import {
	heardBack,
	jobDefinitions,
	jobRun,
	latestLoggedEvent,
	type DispatchedEvent,
} from '$lib/jobs/jobs.platform';
import {
	automatedPullRequestMetadata,
	recordMergedPullRequest,
	type AutomatedPullRequestMetadata,
	type PullRequestAutomationContext,
} from '$shared/repositories/repositories.platform';
import { checkFixJobContext, reviewFixJobContext } from '../domain/pull-request-fix-prompt';
import {
	jobStep,
	reviewFeedbackToAddress,
	reviewToAddress,
	shipBackoffMs,
	type ShippingMove,
	type ShippingSnapshot,
} from '../domain/shipping';
import {
	clearShipRequests,
	getShip,
	settleShipRequest,
	type ShipPatch,
	type ShipRow,
} from './ship.repository';
import {
	dropShip,
	saveShip,
	setShipAlarm,
	settleShipRequests,
	shippingBuiltin,
	type ShipDeps,
} from './ship-store';
import type { ShipTarget } from './ship-target';

export type Idleness = Readonly<{ idle: boolean; settlesInMs: number | null }>;

export type ShipState = Readonly<{
	row: ShipRow;
	target: ShipTarget;
	worktree: WorktreeStatus;
	snapshot: ShippingSnapshot;
	idleness: Idleness;
	recheck: boolean;
	move: ShippingMove;
}>;

type SettledJob = Readonly<{ builtin: ShippingJobBuiltin | null; agentRunId: string | null }>;

const SHIPPING_RESULTS: readonly EventChannel[] = [
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
];

export async function actOnShipMove(
	deps: ShipDeps,
	state: ShipState,
	event: DispatchedEvent,
): Promise<void> {
	const workstreamId = state.row.workstreamId;
	try {
		if (state.recheck) await recheck(deps, state, event);
		else await apply(deps, state, event);
	} catch (error) {
		shipFailed(deps, workstreamId, error);
	} finally {
		if (deps.running()) deps.reader.watch(workstreamId);
	}
}

async function recheck(deps: ShipDeps, state: ShipState, event: DispatchedEvent): Promise<void> {
	const { row, move } = state;
	if (move.kind === 'wait' && move.step === 'waiting-for-agent') {
		settleAlarm(deps, state);
		return;
	}
	const unchanged =
		(move.kind === 'needs-you' && move.reason === row.needsYou?.reason) || move.kind === 'backoff';
	if (unchanged) return;
	const resumed = saveShip(
		deps,
		row.workstreamId,
		{ phase: 'queued', step: null, needsYou: null, lastError: null, nextAttemptAt: null },
		'needs-you',
	);
	if (resumed !== null) await apply(deps, { ...state, row: resumed }, event);
}

async function apply(deps: ShipDeps, state: ShipState, event: DispatchedEvent): Promise<void> {
	const { row, move } = state;
	const workstreamId = row.workstreamId;
	switch (move.kind) {
		case 'idle':
			settleShipRequests(deps, row);
			saveShip(deps, workstreamId, { step: null, lastError: move.problem, nextAttemptAt: null });
			return;
		case 'wait':
			saveShip(deps, workstreamId, { step: move.step });
			if (move.until !== undefined) setShipAlarm(deps, workstreamId, 'checks', move.until);
			if (move.step === 'waiting-for-agent') settleAlarm(deps, state);
			return;
		case 'backoff':
			setShipAlarm(deps, workstreamId, 'retry', state.snapshot.backoffUntil ?? deps.now());
			return;
		case 'read-pull-request':
			saveShip(deps, workstreamId, { step: 'waiting-for-github' });
			return;
		case 'needs-you':
			saveShip(
				deps,
				workstreamId,
				{
					phase: 'needs-you',
					step: null,
					needsYou: { reason: move.reason, detail: move.detail, jobRunId: move.jobRunId },
				},
				'queued',
			);
			return;
		case 'run-job':
			await runJob(deps, state, move, event);
			if (move.builtin === 'address-review') {
				settleShipRequest(deps.context.db, workstreamId, 'review', row.requests.review);
			}
			return;
		case 'land':
			if (!row.keep) saveShip(deps, workstreamId, { step: 'archiving' });
			await land(deps, state);
			return;
		default:
			await act(deps, state, move, event);
	}
}

async function act(
	deps: ShipDeps,
	state: ShipState,
	move: ShippingMove,
	event: DispatchedEvent,
): Promise<void> {
	const { row, target } = state;
	const { db, commands } = deps.context;
	const workstreamId = row.workstreamId;
	const pullRequestNumber = row.pullRequestNumber ?? 0;
	switch (move.kind) {
		case 'commit':
			await commit(deps, state);
			settleShipRequest(db, workstreamId, 'push', row.requests.push);
			deps.reader.forget(workstreamId);
			break;
		case 'push':
			saveShip(deps, workstreamId, { step: 'pushing' });
			await commitAndPush(deps, state, true);
			deps.reader.forget(workstreamId);
			break;
		case 'open-draft':
			saveShip(deps, workstreamId, { step: 'opening-draft' });
			await openPullRequest(deps, state);
			await readAgain(deps, workstreamId);
			break;
		case 'mark-ready':
			saveShip(deps, workstreamId, { step: 'marking-ready' });
			await deps.ops.markReady({ repoId: target.repoId, workstreamId, pullRequestNumber });
			await readAgain(deps, workstreamId);
			break;
		case 'update-branch': {
			saveShip(deps, workstreamId, { step: 'updating-branch' });
			await commands.call('repositories.pull-workstream', {
				workstreamId,
				baseBranch: target.base,
			});
			const updated = await commands.call('repositories.workstream-status', { workstreamId });
			deps.reader.forget(workstreamId);
			if (updated.ahead === 0 && updated.operationInProgress === null) {
				shipRecovered(deps, workstreamId);
				saveShip(deps, workstreamId, { step: 'waiting-for-github' });
				return;
			}
			break;
		}
		case 'resolve-threads':
			await deps.ops.resolveAddressedReviewThreads({ workstreamId, runId: move.agentRunId });
			saveShip(deps, workstreamId, { settledJobRunId: null });
			await readAgain(deps, workstreamId);
			break;
		case 'merge':
			saveShip(deps, workstreamId, { step: 'merging' });
			if (await commands.call('chat.workstream-has-working-run', { workstreamId })) {
				saveShip(deps, workstreamId, { step: 'waiting-for-agent' });
				return;
			}
			await deps.ops.merge({
				repoId: target.repoId,
				workstreamId,
				pullRequestNumber,
				expectedHeadSha: move.headSha,
				mergeMethod: move.method,
			});
			await readAgain(deps, workstreamId);
			break;
		default:
			return;
	}
	shipRecovered(deps, workstreamId);
	if (!heardBack(db, event.id, SHIPPING_RESULTS)) {
		setShipAlarm(deps, workstreamId, 'retry', deps.now() + deps.delays.githubPollMs);
	}
}

async function readAgain(deps: ShipDeps, workstreamId: string): Promise<void> {
	deps.reader.forget(workstreamId);
	await deps.reader.read(workstreamId).catch(() => undefined);
}

function settleAlarm(deps: ShipDeps, state: ShipState): void {
	const settles = state.idleness.settlesInMs;
	if (settles !== null) setShipAlarm(deps, state.row.workstreamId, 'idle', deps.now() + settles);
}

async function commit(deps: ShipDeps, state: ShipState): Promise<AutomatedPullRequestMetadata> {
	const { row, target, worktree } = state;
	const workstreamId = row.workstreamId;
	const shipContext = workstreamShipContext(deps.context.db, workstreamId);
	const metadata = shipMetadata(target, worktree.dirtyPaths, shipContext);
	const settled = settledJob(deps, row);
	if (worktree.dirtyPaths.length > 0 || worktree.operationInProgress === 'merge') {
		const message = commitMessage(worktree, settled, metadata, target);
		const run = settled
			? settled.agentRunId === null
				? null
				: { id: settled.agentRunId, messageIfAlreadyCommitted: message }
			: metadata.commitRun;
		await deps.context.commands.call('repositories.commit-workstream', {
			workstreamId,
			message,
			...(run ? { run } : {}),
		});
	}
	if (settled !== null && settled.builtin !== 'address-review') {
		saveShip(deps, workstreamId, { settledJobRunId: null });
	}
	return metadata;
}

async function commitAndPush(deps: ShipDeps, state: ShipState, retitle: boolean): Promise<void> {
	const { row, target } = state;
	const workstreamId = row.workstreamId;
	const shipContext = workstreamShipContext(deps.context.db, workstreamId);
	const metadata = await commit(deps, state);
	await deps.context.commands.call('repositories.push-workstream', {
		workstreamId,
		expectedRepositoryFullName: target.repository.fullName,
	});
	if (retitle && (shipContext.runSummaries?.length ?? 0) > 0) {
		await retitlePullRequest(deps, target, workstreamId, metadata.title, metadata.body);
	}
}

async function openPullRequest(deps: ShipDeps, state: ShipState): Promise<void> {
	const { row, target } = state;
	const workstreamId = row.workstreamId;
	const head = target.workstream.branch;
	const existing = await deps.ops.status({
		repoId: target.repoId,
		workstreamId,
		head,
		base: target.base,
	});
	if (existing.state === 'open' && existing.number !== null) {
		saveShip(deps, workstreamId, {
			pullRequestNumber: existing.number,
			pullRequestUrl: existing.url,
		});
		return;
	}
	await commitAndPush(deps, state, false);
	const metadata = shipMetadata(
		target,
		state.worktree.dirtyPaths,
		workstreamShipContext(deps.context.db, workstreamId),
	);
	const created = await deps.ops.create({
		repoId: target.repoId,
		workstreamId,
		head,
		base: target.base,
		title: metadata.title,
		body: metadata.body,
		draft: row.phase !== 'queued',
	});
	if (created.number === null) {
		throw new Error('GitHub created the pull request but did not return its number');
	}
	saveShip(deps, workstreamId, {
		pullRequestNumber: created.number,
		pullRequestUrl: created.url,
		generatedTitle: metadata.title,
		generatedBody: metadata.body,
	});
}

export async function retitlePullRequest(
	deps: ShipDeps,
	target: ShipTarget,
	workstreamId: string,
	title: string,
	body: string | null,
): Promise<void> {
	const row = getShip(deps.context.db, workstreamId);
	if (!row?.pullRequestNumber) return;
	const { generatedTitle } = row;
	const generatedBody = body === null ? null : row.generatedBody;
	if (generatedTitle === null && generatedBody === null) return;
	try {
		const owned = await deps.ops.updateMetadata({
			repoId: target.repoId,
			workstreamId,
			pullRequestNumber: row.pullRequestNumber,
			...(generatedTitle === null ? {} : { title: { expected: generatedTitle, next: title } }),
			...(generatedBody === null || body === null
				? {}
				: { body: { expected: generatedBody, next: body } }),
		});
		saveShip(deps, workstreamId, {
			generatedTitle: generatedTitle === null ? null : owned.title,
			...(generatedBody === null ? {} : { generatedBody: owned.body }),
		});
	} catch {
		return;
	}
}

async function runJob(
	deps: ShipDeps,
	state: ShipState,
	move: Extract<ShippingMove, { kind: 'run-job' }>,
	event: DispatchedEvent,
): Promise<void> {
	const { db, commands } = deps.context;
	const workstreamId = state.row.workstreamId;
	const definition = jobDefinitions(db).find((candidate) => candidate.builtin === move.builtin);
	if (!definition) throw new Error(`The built-in ${move.builtin} job is missing`);
	const jobContext = await shippingJobContext(deps, state, move.builtin);
	const causeEventId = pullRequestRead(
		deps,
		workstreamId,
		state.snapshot.pullRequest?.pullRequestNumber ?? state.row.pullRequestNumber,
		event.id,
	);
	const run = await commands.call('jobs.run', {
		definitionId: definition.id,
		workstreamId,
		...(jobContext === null ? {} : { context: jobContext }),
		origin: 'merge-queue',
		...(causeEventId === null ? {} : { causeEventId }),
	});
	const started: ShipPatch = {
		activeJobRunId: run.id,
		attempts: move.attempt,
		failureSignature: move.signature,
		step: jobStep(move.builtin),
		lastError: null,
		nextAttemptAt: null,
		failures: 0,
		settledJobRunId: null,
	};
	const saved =
		saveShip(deps, workstreamId, started, state.row.phase) ??
		(state.row.phase === 'queued' ? null : saveShip(deps, workstreamId, started, 'queued'));
	if (!saved) await commands.call('jobs.cancel-run', { jobRunId: run.id }).catch(() => undefined);
}

function pullRequestRead(
	deps: ShipDeps,
	workstreamId: string,
	pullRequestNumber: number | null,
	handled: number | null,
): number | null {
	const read = latestLoggedEvent(
		deps.context.db,
		PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
		workstreamId,
	);
	const payload = read?.payload;
	if (
		read &&
		pullRequestNumber !== null &&
		isRecord(payload) &&
		payload['pullRequestNumber'] === pullRequestNumber
	) {
		return read.id;
	}
	return handled;
}

async function shippingJobContext(
	deps: ShipDeps,
	state: ShipState,
	builtin: ShippingJobBuiltin,
): Promise<string | null> {
	const { target, snapshot, row } = state;
	const pullRequestNumber = snapshot.pullRequest?.pullRequestNumber ?? row.pullRequestNumber ?? 0;
	switch (builtin) {
		case 'update-from-main':
		case 'resolve-conflicts':
			return null;
		case 'fix-checks':
			return checkFixJobContext({
				pullRequestNumber,
				failingChecks: (snapshot.pullRequest?.blockingChecks ?? []).map((check) => ({
					name: check.name,
					appId: check.appId,
					conclusion: check.state,
					state: check.state,
					required: check.required,
				})),
				checkDiagnostics: await deps.ops.checkDiagnostics({
					repoId: target.repoId,
					workstreamId: row.workstreamId,
					pullRequestNumber,
				}),
			});
		case 'address-review': {
			const feedback = await deps.ops.reviewFeedback({
				repoId: target.repoId,
				workstreamId: row.workstreamId,
				pullRequestNumber,
			});
			return reviewFixJobContext({
				pullRequestNumber,
				reviewFeedback: snapshot.pullRequest
					? reviewFeedbackToAddress(
							feedback,
							reviewToAddress(snapshot.pullRequest, snapshot.addressedReviews),
						)
					: feedback,
			});
		}
	}
}

async function land(deps: ShipDeps, state: ShipState): Promise<void> {
	const { row, snapshot } = state;
	const { db, events, commands } = deps.context;
	const workstreamId = row.workstreamId;
	const pullRequestNumber = snapshot.pullRequest?.pullRequestNumber ?? row.pullRequestNumber;
	const pullRequestUrl = snapshot.pullRequest?.pullRequestUrl ?? row.pullRequestUrl;
	if (pullRequestNumber !== null) {
		recordMergedPullRequest(db, workstreamId, { number: pullRequestNumber, url: pullRequestUrl });
	}
	events.emit('pull-requests:ship-changed', {
		workstreamId,
		state: null,
		...(pullRequestNumber === null ? {} : { merged: { pullRequestNumber, pullRequestUrl } }),
	});
	if (!row.keep) await commands.call('repositories.archive-workstream', { workstreamId });
	dropShip(deps, workstreamId);
}

export function shipFailed(deps: ShipDeps, workstreamId: string, error: unknown): void {
	if (!deps.running()) return;
	deps.reader.forget(workstreamId);
	const row = getShip(deps.context.db, workstreamId);
	if (!row) return;
	const detail = describeError(error);
	const failures = row.failures + 1;
	const due = deps.now() + shipBackoffMs(failures, deps.delays);
	if (row.phase === 'needs-you') {
		saveShip(deps, workstreamId, { failures });
		setShipAlarm(deps, workstreamId, 'retry', due);
		return;
	}
	if (githubAuthRejected(error)) {
		if (row.phase === 'queued') {
			saveShip(
				deps,
				workstreamId,
				{
					phase: 'needs-you',
					step: null,
					needsYou: { reason: 'github-reconnect', detail, jobRunId: null },
					failures,
				},
				'queued',
			);
			setShipAlarm(deps, workstreamId, 'retry', due);
			return;
		}
		settleShipRequest(deps.context.db, workstreamId, 'push', row.requests.push);
		saveShip(deps, workstreamId, { step: null, lastError: detail });
		return;
	}
	if (row.phase === 'local') {
		clearShipRequests(deps.context.db, workstreamId);
		saveShip(deps, workstreamId, { step: null, lastError: detail });
		return;
	}
	saveShip(deps, workstreamId, {
		lastError: detail,
		nextAttemptAt: new Date(due).toISOString(),
		failures,
	});
	setShipAlarm(deps, workstreamId, 'retry', due);
}

function shipRecovered(deps: ShipDeps, workstreamId: string): void {
	const row = getShip(deps.context.db, workstreamId);
	if (row && (row.lastError !== null || row.nextAttemptAt !== null || row.failures > 0)) {
		saveShip(deps, workstreamId, { lastError: null, nextAttemptAt: null, failures: 0 });
	}
}

export function settledJob(deps: ShipDeps, row: ShipRow): SettledJob | null {
	const current = getShip(deps.context.db, row.workstreamId) ?? row;
	const job =
		current.settledJobRunId === null ? null : jobRun(deps.context.db, current.settledJobRunId);
	return job ? { builtin: shippingBuiltin(deps, job), agentRunId: job.agentRunId } : null;
}

export function shipMetadata(
	target: ShipTarget,
	changedPaths: readonly string[],
	shipContext: PullRequestAutomationContext,
): AutomatedPullRequestMetadata {
	return automatedPullRequestMetadata({
		branch: target.workstream.branch,
		baseBranch: target.base,
		changedPaths,
		workstreamPath: target.workstream.path,
		context: shipContext,
	});
}

function commitMessage(
	worktree: WorktreeStatus,
	settled: SettledJob | null,
	metadata: AutomatedPullRequestMetadata,
	target: ShipTarget,
): string {
	if (worktree.operationInProgress === 'merge') {
		return `Merge ${target.base} into ${target.workstream.branch}`;
	}
	if (settled?.builtin === 'fix-checks') return 'Fix failing checks';
	if (settled?.builtin === 'address-review') return 'Address review feedback';
	return metadata.commitMessage;
}

function githubAuthRejected(error: unknown): boolean {
	return (
		isGhError(error, 'auth-required') ||
		isGhError(error, 'not-installed') ||
		isGitError(error, 'auth-failed') ||
		/\bbad credentials\b|\bHTTP 401\b/iu.test(describeError(error))
	);
}
