import {
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type { ShippingAutomationBuiltin } from '$contract/automations';
import { SIGN_CONTRIBUTIONS_SETTING, signsContributions } from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import { isRecord } from '$main/db/rows';
import { describeError, isGhError, isGitError, remoteRefusal, waitsForYou } from '$main/errors';
import { commitLine, workstreamAgentCount, workstreamShipContext } from '$lib/chat/chat.platform';
import {
	heardBack,
	automationDefinitions,
	automationRun,
	latestLoggedEvent,
	type DispatchedEvent,
} from '$lib/automations/automations.platform';
import {
	automatedPullRequestMetadata,
	recordMergedPullRequest,
	type AutomatedPullRequestMetadata,
	type PullRequestAutomationContext,
	type PullRequestCredit,
} from '$shared/repositories/repositories.platform';
import {
	checkFixAutomationContext,
	reviewFixAutomationContext,
} from '../domain/pull-request-fix-prompt';
import {
	checksRerunOf,
	automationStep,
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
	NO_SHIP_FAILURE,
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

type SettledAutomation = Readonly<{
	builtin: ShippingAutomationBuiltin | null;
	agentRunId: string | null;
	commitLine: string;
}>;

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
		(move.kind === 'needs-you' && move.reason === row.needsYou?.reason) ||
		move.kind === 'backoff' ||
		move.kind === 'held';
	if (unchanged) return;
	const resumed = saveShip(
		deps,
		row.workstreamId,
		{ phase: 'queued', step: null, needsYou: null, ...NO_SHIP_FAILURE },
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
			saveShip(deps, workstreamId, { step: null, ...NO_SHIP_FAILURE, lastError: move.problem });
			return;
		case 'wait':
			saveShip(deps, workstreamId, { step: move.step });
			if (move.until !== undefined) setShipAlarm(deps, workstreamId, 'checks', move.until);
			if (move.step === 'waiting-for-agent') settleAlarm(deps, state);
			return;
		case 'backoff':
			setShipAlarm(deps, workstreamId, 'retry', state.snapshot.backoffUntil ?? deps.now());
			return;
		case 'held':
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
					needsYou: {
						reason: move.reason,
						detail: move.detail,
						automationRunId: move.automationRunId,
					},
				},
				'queued',
			);
			return;
		case 'run-automation':
			await runAutomation(deps, state, move, event);
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
		case 'rerun-checks':
			saveShip(deps, workstreamId, { step: 'rerunning-checks' });
			if (!(await rerunChecks(deps, state, move))) {
				await runAutomation(deps, state, fixChecksAutomation(move), event);
				return;
			}
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
			saveShip(deps, workstreamId, { settledAutomationRunId: null });
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
	const settled = settledAutomation(deps, row);
	if (worktree.dirtyPaths.length > 0 || worktree.operationInProgress === 'merge') {
		const fallback = commitMessage(worktree, settled, metadata, target, '');
		const message = commitMessage(worktree, settled, metadata, target, settled?.commitLine ?? '');
		const run = settled
			? settled.agentRunId === null
				? null
				: { id: settled.agentRunId, messageIfAlreadyCommitted: fallback }
			: metadata.commitRun;
		await deps.context.commands.call('repositories.commit-workstream', {
			workstreamId,
			message,
			...(run ? { run } : {}),
			signed: await signs(deps),
		});
	}
	if (settled !== null && settled.builtin !== 'address-review') {
		saveShip(deps, workstreamId, { settledAutomationRunId: null });
	}
	return metadata;
}

async function commitAndPush(deps: ShipDeps, state: ShipState, retitle: boolean): Promise<void> {
	const { row, target } = state;
	const workstreamId = row.workstreamId;
	const shipContext = workstreamShipContext(deps.context.db, workstreamId);
	await commit(deps, state);
	await deps.context.commands.call('repositories.push-workstream', {
		workstreamId,
		expectedRepositoryFullName: target.repository.fullName,
	});
	if (retitle && (shipContext.runSummaries?.length ?? 0) > 0) {
		const { title, body } = shipMetadata(
			target,
			state.worktree.dirtyPaths,
			shipContext,
			await shipCredit(deps, workstreamId),
		);
		await retitlePullRequest(deps, target, workstreamId, title, body);
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
		await shipCredit(deps, workstreamId),
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

async function runAutomation(
	deps: ShipDeps,
	state: ShipState,
	move: Extract<ShippingMove, { kind: 'run-automation' }>,
	event: DispatchedEvent,
): Promise<void> {
	const { db, commands } = deps.context;
	const workstreamId = state.row.workstreamId;
	const definition = automationDefinitions(db).find(
		(candidate) => candidate.builtin === move.builtin,
	);
	if (!definition) throw new Error(`The built-in ${move.builtin} automation is missing`);
	const automationContext = await shippingAutomationContext(deps, state, move.builtin);
	const causeEventId = pullRequestRead(
		deps,
		workstreamId,
		state.snapshot.pullRequest?.pullRequestNumber ?? state.row.pullRequestNumber,
		event.id,
	);
	const run = await commands.call('automations.run', {
		definitionId: definition.id,
		workstreamId,
		...(automationContext === null ? {} : { context: automationContext }),
		origin: 'merge-queue',
		...(causeEventId === null ? {} : { causeEventId }),
	});
	const started: ShipPatch = {
		activeAutomationRunId: run.id,
		attempts: move.attempt,
		failureSignature: move.signature,
		step: automationStep(move.builtin),
		...NO_SHIP_FAILURE,
		settledAutomationRunId: null,
	};
	const saved =
		saveShip(deps, workstreamId, started, state.row.phase) ??
		(state.row.phase === 'queued' ? null : saveShip(deps, workstreamId, started, 'queued'));
	if (!saved)
		await commands
			.call('automations.cancel-run', { automationRunId: run.id })
			.catch(() => undefined);
}

async function rerunChecks(
	deps: ShipDeps,
	state: ShipState,
	move: Extract<ShippingMove, { kind: 'rerun-checks' }>,
): Promise<boolean> {
	const workstreamId = state.row.workstreamId;
	try {
		await deps.ops.rerunFailedChecks({
			repoId: state.target.repoId,
			workstreamId,
			runIds: move.runIds,
		});
	} catch (error) {
		if (githubAuthRejected(error)) throw error;
		return false;
	}
	saveShip(deps, workstreamId, {
		failureSignature: move.signature,
		attempts: 0,
		checksRerun: { headSha: move.headSha, at: new Date(deps.now()).toISOString() },
	});
	return true;
}

function fixChecksAutomation(
	move: Extract<ShippingMove, { kind: 'rerun-checks' }>,
): Extract<ShippingMove, { kind: 'run-automation' }> {
	return { kind: 'run-automation', builtin: 'fix-checks', signature: move.signature, attempt: 1 };
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

async function shippingAutomationContext(
	deps: ShipDeps,
	state: ShipState,
	builtin: ShippingAutomationBuiltin,
): Promise<string | null> {
	const { target, snapshot, row } = state;
	const pullRequestNumber = snapshot.pullRequest?.pullRequestNumber ?? row.pullRequestNumber ?? 0;
	switch (builtin) {
		case 'update-from-main':
		case 'resolve-conflicts':
			return null;
		case 'fix-checks':
			return checkFixAutomationContext({
				pullRequestNumber,
				rerun: snapshot.pullRequest !== null && checksRerunOf(snapshot, snapshot.pullRequest),
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
			return reviewFixAutomationContext({
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
	const now = deps.now();
	const due = now + shipBackoffMs(failures, deps.delays);
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
					needsYou: { reason: 'github-reconnect', detail, automationRunId: null },
					...NO_SHIP_FAILURE,
					failures,
				},
				'queued',
			);
			setShipAlarm(deps, workstreamId, 'retry', due);
			return;
		}
		settleShipRequest(deps.context.db, workstreamId, 'push', row.requests.push);
		saveShip(deps, workstreamId, { step: null, ...NO_SHIP_FAILURE, lastError: detail });
		return;
	}
	if (row.phase === 'local') {
		clearShipRequests(deps.context.db, workstreamId);
		saveShip(deps, workstreamId, { step: null, ...NO_SHIP_FAILURE, lastError: detail });
		return;
	}
	const waitsFor = waitsForYou(error);
	saveShip(deps, workstreamId, {
		lastError: detail,
		githubSaid: remoteRefusal(error),
		failures,
		failedSince: row.failedSince ?? new Date(now).toISOString(),
		nextAttemptAt: waitsFor === null ? new Date(due).toISOString() : null,
		waitsFor,
	});
	if (waitsFor === null) setShipAlarm(deps, workstreamId, 'retry', due);
}

function shipRecovered(deps: ShipDeps, workstreamId: string): void {
	const row = getShip(deps.context.db, workstreamId);
	if (row && (row.lastError !== null || row.nextAttemptAt !== null || row.failures > 0)) {
		saveShip(deps, workstreamId, NO_SHIP_FAILURE);
	}
}

export function settledAutomation(deps: ShipDeps, row: ShipRow): SettledAutomation | null {
	const current = getShip(deps.context.db, row.workstreamId) ?? row;
	const automation =
		current.settledAutomationRunId === null
			? null
			: automationRun(deps.context.db, current.settledAutomationRunId);
	return automation
		? {
				builtin: shippingBuiltin(deps, automation),
				agentRunId: automation.agentRunId,
				commitLine: commitLine(automation.detail ?? ''),
			}
		: null;
}

async function signs(deps: ShipDeps): Promise<boolean> {
	const settings = await deps.context.commands
		.call('app.list-settings', undefined)
		.catch(() => null);
	return settings !== null && signsContributions(settings[SIGN_CONTRIBUTIONS_SETTING]);
}

async function shipCredit(
	deps: ShipDeps,
	workstreamId: string,
): Promise<PullRequestCredit | undefined> {
	if (!(await signs(deps))) return undefined;
	return {
		chef: (await deps.chef?.().catch(() => null)) ?? null,
		agents: workstreamAgentCount(deps.context.db, workstreamId),
	};
}

export function shipMetadata(
	target: ShipTarget,
	changedPaths: readonly string[],
	shipContext: PullRequestAutomationContext,
	credit?: PullRequestCredit,
): AutomatedPullRequestMetadata {
	return automatedPullRequestMetadata({
		branch: target.workstream.branch,
		baseBranch: target.base,
		changedPaths,
		workstreamPath: target.workstream.path,
		context: shipContext,
		...(credit ? { credit } : {}),
	});
}

function commitMessage(
	worktree: WorktreeStatus,
	settled: SettledAutomation | null,
	metadata: AutomatedPullRequestMetadata,
	target: ShipTarget,
	line: string,
): string {
	if (worktree.operationInProgress === 'merge') {
		return `Merge ${target.base} into ${target.workstream.branch}`;
	}
	if (line !== '') return line;
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
