import {
	APP_STARTED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	AUTOMATIONS_RUN_FINISHED_CHANNEL,
	AUTOMATIONS_TIME_REACHED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import { AUTOMATION_INTERRUPTED_DETAIL, type AutomationRunRecord } from '$contract/automations';
import {
	DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
} from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import { isRecord } from '$main/db/rows';
import { latestRunEndedAt, workstreamShipContext } from '$lib/chat/chat.platform';
import {
	activeShippingAutomationRun,
	automationDefinitions,
	automationRun,
	latestShippingAutomationRun,
	type DispatchedEvent,
	type ShippingDecision,
	type ShippingRule,
	type ShippingTrigger,
} from '$lib/automations/automations.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import {
	addressedChangeRequests,
	automationStep,
	clampedFixAttempts,
	isUpdateAutomation,
	automationIsActive,
	nextShippingMove,
	pullRequestFacts,
	reviewToStart,
	type PullRequestFacts,
	type ShippingSnapshot,
} from '../domain/shipping';
import { shipAllClicked } from './ship-intents';
import {
	actOnShipMove,
	retitlePullRequest,
	reviewContext,
	settledAutomation,
	shipFailed,
	shipMetadata,
	type Idleness,
	type ShipState,
} from './ship-moves';
import {
	getShip,
	listShips,
	requestShip,
	settleShipRequest,
	type ShipRequest,
	type ShipRow,
} from './ship.repository';
import {
	dropShip,
	NO_SHIP_FAILURE,
	saveShip,
	shipping,
	shippingBuiltin,
	startingAlone,
	trackShip,
	type ShipDeps,
} from './ship-store';
import { shipTarget } from './ship-target';

const FRESH_READ_MS = 2_000;

export function createShippingRule(deps: ShipDeps): ShippingRule {
	return {
		hear: (event) => hear(deps, event),
		decide: (workstreamId) => decide(deps, workstreamId),
		merging: (workstreamId) => {
			const phase = getShip(deps.context.db, workstreamId)?.phase;
			return phase === 'queued' || phase === 'needs-you';
		},
		triggered: (trigger) => triggered(deps, trigger),
	};
}

async function hear(deps: ShipDeps, event: DispatchedEvent): Promise<readonly string[]> {
	if (!deps.running()) return [];
	const { db } = deps.context;
	const { channel, payload } = event;
	if (channel === APP_STARTED_CHANNEL) return resume(deps);
	if (channel === AUTOMATIONS_RUN_FINISHED_CHANNEL) return runFinished(deps, payload);
	const workstreamId = stringField(payload, 'workstreamId');
	if (workstreamId === null) return [];
	switch (channel) {
		case PULL_REQUESTS_BUTTON_CLICKED_CHANNEL:
			return buttonClicked(deps, workstreamId, event);
		case AUTOMATIONS_TIME_REACHED_CHANNEL:
			return stringField(payload, 'wait') === 'resume' || !getShip(db, workstreamId)
				? []
				: [workstreamId];
		case PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL:
			return pullRequestChanged(deps, workstreamId, payload);
		case CHAT_TURN_FINISHED_CHANNEL:
			return workEnded(deps, workstreamId);
		case REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL:
		case REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL:
		case REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL: {
			const row = getShip(db, workstreamId);
			return row && shipping(row) ? [workstreamId] : [];
		}
		case REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL:
			return getShip(db, workstreamId)?.needsYou?.reason === 'operation-in-progress'
				? [workstreamId]
				: [];
		case REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL:
			dropShip(deps, workstreamId);
			return [];
		default:
			return [];
	}
}

function resume(deps: ShipDeps): readonly string[] {
	const { db } = deps.context;
	return listShips(db).flatMap((row) => {
		if (row.phase === 'draft' && row.step !== null) requestShip(db, row.workstreamId, 'push');
		return shipping(row) ? [row.workstreamId] : [];
	});
}

async function buttonClicked(
	deps: ShipDeps,
	workstreamId: string,
	event: DispatchedEvent,
): Promise<readonly string[]> {
	const all = shipAllClicked(event.payload);
	if (all === null) return [workstreamId];
	const builtin = all.button === 'draft-all' ? 'open-draft' : 'merge';
	const definition = automationDefinitions(deps.context.db).find(
		(candidate) => candidate.builtin === builtin,
	);
	if (!definition) throw new Error(`The built-in ${builtin} automation is missing`);
	await Promise.all(
		all.workstreamIds.map((started) =>
			deps.context.commands.call('automations.run', {
				definitionId: definition.id,
				workstreamId: started,
				origin: 'merge-queue',
				...(all.chatSessionId === null ? {} : { chatSessionId: all.chatSessionId }),
				...(event.id === null ? {} : { causeEventId: event.id }),
			}),
		),
	);
	return [];
}

async function pullRequestChanged(
	deps: ShipDeps,
	workstreamId: string,
	payload: unknown,
): Promise<readonly string[]> {
	const facts = pullRequestFacts(payload);
	if (facts === null) return [];
	const open = facts.state === 'open' || facts.state === 'draft';
	if (open && facts.reviewDecision === 'changes_requested' && reviewsOnItsOwn(deps)) {
		await request(deps, workstreamId, 'review');
	}
	return getShip(deps.context.db, workstreamId) ? [workstreamId] : [];
}

function reviewsOnItsOwn(deps: ShipDeps): boolean {
	return automationDefinitions(deps.context.db).some(
		(definition) => definition.builtin === 'address-review' && definition.trigger?.mode === 'auto',
	);
}

async function workEnded(deps: ShipDeps, workstreamId: string): Promise<readonly string[]> {
	const row = await trackShip(deps, workstreamId);
	if (!row) return [];
	if (row.phase === 'local' || row.phase === 'draft') {
		requestShip(deps.context.db, workstreamId, 'push');
	}
	return [workstreamId];
}

async function runFinished(deps: ShipDeps, payload: unknown): Promise<readonly string[]> {
	const { db } = deps.context;
	const runId = isRecord(payload) ? stringField(payload['run'], 'id') : null;
	const run = runId === null ? null : automationRun(db, runId);
	if (!run || run.workstreamId === null) return [];
	await deps.starting.get(run.workstreamId);
	const row = getShip(db, run.workstreamId);
	if (row) await settleOtherAutomation(deps, row, run);
	if (row?.activeAutomationRunId === run.id || run.origin === 'merge-queue')
		return [run.workstreamId];
	if (run.agentRunId !== null && run.status !== 'cancelled') {
		return workEnded(deps, run.workstreamId);
	}
	return row ? [run.workstreamId] : [];
}

async function triggered(
	deps: ShipDeps,
	{ builtin, event, start }: ShippingTrigger,
): Promise<boolean> {
	const facts = builtin === 'address-review' ? pullRequestFacts(event.payload) : null;
	if (facts === null || !deps.running()) return false;
	await startingAlone(deps, facts.workstreamId, () => startReview(deps, facts, start));
	return true;
}

async function startReview(
	deps: ShipDeps,
	pullRequest: PullRequestFacts,
	start: ShippingTrigger['start'],
): Promise<void> {
	const { db, commands } = deps.context;
	const { workstreamId } = pullRequest;
	const row = await trackShip(deps, workstreamId);
	if (!row || row.activeAutomationRunId !== null || row.settledAutomationRunId !== null) return;
	if (activeShippingAutomationRun(db, workstreamId) !== null) return;
	const working = row.phase === 'local' || row.phase === 'draft';
	const limit = working ? DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS : await fixAttemptLimit(deps);
	const review = reviewToStart(pullRequest, row, limit);
	if (review === null || !(await readIdleness(deps, workstreamId)).idle) return;
	const worktree = await commands.call('repositories.workstream-status', { workstreamId });
	if (worktree.dirtyPaths.length > 0 || worktree.operationInProgress !== null) return;
	const target = await shipTarget(db, workstreamId);
	const run = await start(
		await reviewContext(
			deps,
			target,
			pullRequest.pullRequestNumber,
			pullRequest,
			row.addressedReviews,
		),
	);
	saveShip(deps, workstreamId, {
		activeAutomationRunId: run.id,
		attempts: review.attempt,
		failureSignature: review.signature,
		step: automationStep('address-review'),
		...NO_SHIP_FAILURE,
	});
	settleShipRequest(db, workstreamId, 'review', row.requests.review);
}

async function request(deps: ShipDeps, workstreamId: string, kind: ShipRequest): Promise<void> {
	const row = await trackShip(deps, workstreamId);
	if (!row || (row.phase !== 'local' && row.phase !== 'draft')) return;
	requestShip(deps.context.db, workstreamId, kind);
}

async function decide(deps: ShipDeps, workstreamId: string): Promise<ShippingDecision | null> {
	try {
		return await decideFromState(deps, workstreamId);
	} catch (error) {
		return decision(deps, workstreamId, 'failed', () => shipFailed(deps, workstreamId, error));
	}
}

async function decideFromState(
	deps: ShipDeps,
	workstreamId: string,
): Promise<ShippingDecision | null> {
	const { db, commands } = deps.context;
	if (!deps.running()) return null;
	const found = getShip(db, workstreamId);
	if (!found) return null;
	if (!getWorkstream(db, workstreamId)) {
		return decision(deps, workstreamId, 'forget', () => dropShip(deps, workstreamId));
	}
	const row = await settleActiveAutomation(deps, found);
	const { requests } = row;
	const working = row.phase === 'local' || row.phase === 'draft';
	if (
		working &&
		requests.push === 0 &&
		requests.review === 0 &&
		row.activeAutomationRunId === null
	) {
		return decision(deps, workstreamId, 'idle', () => {
			saveShip(deps, workstreamId, { step: null });
		});
	}
	const target = await shipTarget(db, workstreamId);
	const idleness = await readIdleness(deps, workstreamId);
	const worktree = await commands.call('repositories.workstream-status', { workstreamId });
	const settled = settledFor(deps, row, worktree);
	const automation = activeShippingAutomationRun(db, workstreamId);
	const lastAutomation = latestShippingAutomationRun(db, workstreamId);
	const recheck = row.phase === 'needs-you';
	let snapshot: ShippingSnapshot = {
		phase: recheck ? 'queued' : row.phase,
		pushRequested: requests.push > 0,
		reviewRequested: requests.review > 0,
		addressedReviews: row.addressedReviews,
		pullRequestNumber: row.pullRequestNumber,
		idle: idleness.idle,
		automation: automation
			? { builtin: shippingBuiltin(deps, automation), status: automation.status }
			: null,
		lastAutomationRunId: lastAutomation?.id ?? null,
		lastAutomationBuiltin: lastAutomation ? shippingBuiltin(deps, lastAutomation) : null,
		settledAutomation: settled?.builtin ?? null,
		worktree,
		threadResolutionRunId: settled?.builtin === 'address-review' ? settled.agentRunId : null,
		failureSignature: row.failureSignature,
		checksRerun:
			row.checksRerun === null
				? null
				: { headSha: row.checksRerun.headSha, at: Date.parse(row.checksRerun.at) },
		fixSucceededAt:
			lastAutomation?.status === 'succeeded' && lastAutomation.finishedAt !== null
				? Date.parse(lastAutomation.finishedAt)
				: null,
		attempts: row.attempts,
		fixAttemptLimit: working ? DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS : await fixAttemptLimit(deps),
		backoffUntil: row.nextAttemptAt === null ? null : Date.parse(row.nextAttemptAt),
		waitsForYou: row.waitsFor !== null,
		now: deps.now(),
		read: false,
		pullRequest: null,
	};
	if (movedOn(deps, row)) return null;
	if (recheck) {
		const read = await deps.reader.read(workstreamId, FRESH_READ_MS);
		if (!read.read) return null;
		snapshot = { ...snapshot, read: true, pullRequest: read.pullRequest };
	}
	let move = nextShippingMove(snapshot);
	if (move.kind === 'read-pull-request') {
		const read = await deps.reader.read(workstreamId, FRESH_READ_MS);
		if (!read.read) {
			const step = row.phase === 'queued' ? 'waiting-for-checks' : 'waiting-for-github';
			return decision(deps, workstreamId, move.kind, () => {
				saveShip(deps, workstreamId, { step });
			});
		}
		snapshot = { ...snapshot, read: true, pullRequest: read.pullRequest };
		move = nextShippingMove(snapshot);
	}
	const state: ShipState = { row, target, worktree, snapshot, idleness, recheck, move };
	return { move: move.kind, act: (event) => actOnShipMove(deps, state, event) };
}

function decision(
	deps: ShipDeps,
	workstreamId: string,
	move: string,
	work: () => void,
): ShippingDecision {
	return {
		move,
		act: async () => {
			try {
				work();
			} finally {
				if (deps.running()) deps.reader.watch(workstreamId);
			}
		},
	};
}

async function settleActiveAutomation(deps: ShipDeps, row: ShipRow): Promise<ShipRow> {
	const automationRunId = row.activeAutomationRunId;
	if (automationRunId === null) return row;
	const { db } = deps.context;
	const automation = automationRun(db, automationRunId);
	if (automation && automationIsActive({ builtin: null, status: automation.status })) return row;
	const builtin = automation ? shippingBuiltin(deps, automation) : null;
	const addressed =
		automation?.status === 'succeeded' && builtin === 'address-review'
			? addressedChangeRequests(row.failureSignature)
			: [];
	if (automation?.status === 'succeeded') await automationSucceeded(deps, row);
	const interrupted =
		automation?.status === 'failed' && automation.detail === AUTOMATION_INTERRUPTED_DETAIL;
	const updateFailed =
		isUpdateAutomation(builtin) && automation?.status === 'failed' && row.phase !== 'queued';
	return (
		saveShip(deps, row.workstreamId, {
			activeAutomationRunId: null,
			settledAutomationRunId:
				automation?.status === 'succeeded' ? automation.id : row.settledAutomationRunId,
			...(addressed.length > 0
				? { addressedReviews: [...new Set([...row.addressedReviews, ...addressed])] }
				: {}),
			...(interrupted ? { attempts: Math.max(0, row.attempts - 1) } : {}),
			...(updateFailed ? { lastError: automation.detail } : {}),
		}) ?? row
	);
}

async function settleOtherAutomation(
	deps: ShipDeps,
	row: ShipRow,
	run: AutomationRunRecord,
): Promise<void> {
	if (run.id === row.activeAutomationRunId || run.status !== 'succeeded') return;
	const builtin = shippingBuiltin(deps, run);
	if (builtin === null || (builtin === 'update-from-main' && run.origin === 'trigger')) return;
	await automationSucceeded(deps, row);
	saveShip(deps, row.workstreamId, { settledAutomationRunId: run.id });
}

async function automationSucceeded(deps: ShipDeps, row: ShipRow): Promise<void> {
	if (row.phase === 'draft') requestShip(deps.context.db, row.workstreamId, 'push');
	if (row.pullRequestNumber === null) return;
	const target = await shipTarget(deps.context.db, row.workstreamId);
	const shipContext = workstreamShipContext(deps.context.db, row.workstreamId);
	await retitlePullRequest(
		deps,
		target,
		row.workstreamId,
		shipMetadata(target, [], shipContext).title,
		null,
	);
}

function movedOn(deps: ShipDeps, row: ShipRow): boolean {
	const { db } = deps.context;
	const current = getShip(db, row.workstreamId);
	if (current?.activeAutomationRunId !== row.activeAutomationRunId) return true;
	if (row.activeAutomationRunId === null) return false;
	const automation = automationRun(db, row.activeAutomationRunId);
	return !automation || !automationIsActive({ builtin: null, status: automation.status });
}

function settledFor(
	deps: ShipDeps,
	row: ShipRow,
	worktree: WorktreeStatus,
): ReturnType<typeof settledAutomation> {
	const settled = settledAutomation(deps, row);
	const clean =
		worktree.dirtyPaths.length === 0 &&
		worktree.ahead === 0 &&
		worktree.operationInProgress === null;
	if (settled && settled.builtin !== 'address-review' && clean) {
		saveShip(deps, row.workstreamId, { settledAutomationRunId: null });
		return null;
	}
	return settled;
}

// ponytail: main cannot see the renderer prompt queue, so idle waits idleDebounceMs after the last turn ends; a main-side prompt queue would make this exact
async function readIdleness(deps: ShipDeps, workstreamId: string): Promise<Idleness> {
	const { db, commands } = deps.context;
	if (await commands.call('chat.workstream-has-working-run', { workstreamId })) {
		return { idle: false, settlesInMs: null };
	}
	const ended = Date.parse(latestRunEndedAt(db, workstreamId) ?? '');
	const remaining = Number.isNaN(ended) ? 0 : ended + deps.delays.idleDebounceMs - deps.now();
	return remaining > 0
		? { idle: false, settlesInMs: remaining }
		: { idle: true, settlesInMs: null };
}

async function fixAttemptLimit(deps: ShipDeps): Promise<number> {
	const settings = await deps.context.commands
		.call('app.list-settings', undefined)
		.catch((): Record<string, string> => ({}));
	return clampedFixAttempts(
		settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING],
		DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	);
}

function stringField(payload: unknown, key: string): string | null {
	if (!isRecord(payload)) return null;
	const value = payload[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}
