import {
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
} from '$contract/events';
import {
	isShippingJobBuiltin,
	type JobRunRecord,
	type ShippingJobBuiltin,
	type ShippingWait,
} from '$contract/jobs';
import type { ShipButton, ShipPhase, ShipStateRecord } from '$contract/pull-requests';
import type { MainContext } from '$main/context';
import { clearAlarm, handledEvent, jobDefinition, setAlarm } from '$lib/jobs/jobs.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import type { ShipDelays } from '../domain/shipping';
import type { PullRequestOperations } from './pull-request-operations';
import type { PullRequestReader } from './pull-request-reader.service';
import {
	deleteShip,
	getShip,
	insertShip,
	settleShipRequest,
	shipRecord,
	updateShip,
	type ShipPatch,
	type ShipRow,
} from './ship.repository';
import { shipTarget } from './ship-target';

export type ShipDeps = Readonly<{
	context: MainContext;
	ops: PullRequestOperations;
	reader: PullRequestReader;
	delays: ShipDelays;
	now: () => number;
	running: () => boolean;
}>;

export const NO_SHIP_FAILURE = {
	lastError: null,
	githubSaid: null,
	failures: 0,
	failedSince: null,
	nextAttemptAt: null,
	waitsFor: null,
} as const satisfies ShipPatch;

export function saveShip(
	deps: ShipDeps,
	workstreamId: string,
	patch: ShipPatch,
	onlyInPhase?: ShipPhase,
	click?: ShipButton,
): ShipRow | null {
	const { db, events } = deps.context;
	if (!deps.running()) return null;
	const before = getShip(db, workstreamId);
	const after = updateShip(db, workstreamId, patch, onlyInPhase);
	if (!after) return null;
	const state = shipRecord(after);
	if (click) emitClicked(deps.context, workstreamId, click, state);
	else if (!before || !sameRecord(shipRecord(before), state)) {
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId, state });
	}
	return after;
}

export function emitClicked(
	context: MainContext,
	workstreamId: string,
	button: ShipButton,
	state: ShipStateRecord | null,
): void {
	context.events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, { workstreamId, button, state });
}

export function setShipAlarm(
	deps: ShipDeps,
	workstreamId: string,
	wait: ShippingWait,
	due: number,
): void {
	if (!deps.running()) return;
	const setBy = handledEvent();
	setAlarm(deps.context.db, shipAlarmKey(workstreamId), {
		workstreamId,
		wait,
		due: new Date(Math.max(due, deps.now())).toISOString(),
		...(setBy === null ? {} : { causeEventId: setBy }),
	});
}

export function forgetShip(deps: ShipDeps, workstreamId: string): void {
	deps.reader.forget(workstreamId);
	deps.reader.watch(workstreamId);
	clearAlarm(deps.context.db, shipAlarmKey(workstreamId));
}

export function shipAlarmKey(workstreamId: string): string {
	return `shipping:${workstreamId}`;
}

export function dropShip(deps: ShipDeps, workstreamId: string): void {
	deleteShip(deps.context.db, workstreamId);
	forgetShip(deps, workstreamId);
}

export function settleShipRequests(deps: ShipDeps, row: ShipRow): void {
	const { db } = deps.context;
	settleShipRequest(db, row.workstreamId, 'push', row.requests.push);
	settleShipRequest(db, row.workstreamId, 'review', row.requests.review);
}

export function shippingBuiltin(deps: ShipDeps, run: JobRunRecord): ShippingJobBuiltin | null {
	const builtin = jobDefinition(deps.context.db, run.definitionId)?.builtin ?? null;
	return isShippingJobBuiltin(builtin) ? builtin : null;
}

export function shipping(row: ShipRow): boolean {
	return (
		row.phase === 'queued' ||
		row.phase === 'needs-you' ||
		row.activeJobRunId !== null ||
		(row.phase === 'draft' && row.step !== null) ||
		row.requests.push + row.requests.review > 0
	);
}

export async function trackShip(deps: ShipDeps, workstreamId: string): Promise<ShipRow | null> {
	const { db, events } = deps.context;
	const existing = getShip(db, workstreamId);
	if (existing) return existing;
	if (getWorkstream(db, workstreamId)?.status !== 'active') return null;
	try {
		await shipTarget(db, workstreamId);
	} catch {
		return null;
	}
	insertShip(db, workstreamId, 'local');
	const tracked = getShip(db, workstreamId);
	if (tracked) {
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId, state: shipRecord(tracked) });
	}
	return tracked;
}

function sameRecord(left: ShipStateRecord, right: ShipStateRecord): boolean {
	return JSON.stringify({ ...left, updatedAt: '' }) === JSON.stringify({ ...right, updatedAt: '' });
}
