import { PULL_REQUESTS_SHIP_CHANGED_CHANNEL } from '$contract/events';
import {
	SHIP_ALL_BUTTONS,
	type ShipAllClicked,
	type ShipButton,
	type ShipStateRecord,
} from '$contract/pull-requests';
import { clearAlarm } from '$lib/jobs/jobs.platform';
import { shipFailure } from '../domain/ship-failure';
import { field, requireString, requireStrings } from './args';
import {
	clearShipRequests,
	getShip,
	insertShip,
	requestShip,
	shipRecord,
	updateShip,
	type ShipPatch,
	type ShipRow,
} from './ship.repository';
import { emitClicked, NO_SHIP_FAILURE, saveShip, shipAlarmKey, type ShipDeps } from './ship-store';
import { ShipError, shipTarget, type ShipTarget } from './ship-target';

export async function clickShip(
	deps: ShipDeps,
	workstreamId: string,
	button: ShipButton,
): Promise<ShipStateRecord | null> {
	deps.reader.forget(workstreamId);
	switch (button) {
		case 'draft':
			return openDraft(deps, workstreamId, button);
		case 'merge':
			return queueMerge(deps, workstreamId, button);
		case 'retry':
			return retry(deps, workstreamId);
		case 'cancel':
			return cancel(deps, workstreamId);
		case 'keep':
			return keepWorkstream(deps, workstreamId);
	}
}

export async function openDraft(
	deps: ShipDeps,
	workstreamId: string,
	click: ShipButton | null = null,
): Promise<ShipStateRecord> {
	const { db } = deps.context;
	const target = await shipTarget(db, workstreamId);
	const row = getShip(db, workstreamId);
	if (row && row.phase !== 'draft' && row.phase !== 'local') return unchanged(deps, row, click);
	if (row?.pullRequestNumber == null) await refuseNothingToShip(deps, target);
	insertShip(db, workstreamId, 'draft');
	requestShip(db, workstreamId, 'push');
	return upsert(deps, workstreamId, click, {
		phase: 'draft',
		step: row?.pullRequestNumber == null ? 'opening-draft' : 'pushing',
		...NO_SHIP_FAILURE,
	});
}

export async function queueMerge(
	deps: ShipDeps,
	workstreamId: string,
	click: ShipButton | null = null,
): Promise<ShipStateRecord> {
	const { db } = deps.context;
	const target = await shipTarget(db, workstreamId);
	const row = getShip(db, workstreamId);
	if (row?.phase === 'queued') return unchanged(deps, row, click);
	if (row?.pullRequestNumber == null) await refuseNothingToShip(deps, target);
	insertShip(db, workstreamId, 'queued');
	return upsert(deps, workstreamId, click, {
		phase: 'queued',
		step: null,
		keep: false,
		queuedAt: new Date(deps.now()).toISOString(),
		attempts: 0,
		failureSignature: null,
		needsYou: null,
		...NO_SHIP_FAILURE,
	});
}

function retry(deps: ShipDeps, workstreamId: string): ShipStateRecord {
	const row = getShip(deps.context.db, workstreamId);
	if (!row) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
	if (shipFailure(row)) return retryNow(deps, row);
	if (row.phase !== 'needs-you') return unchanged(deps, row, 'retry');
	const saved = saveShip(
		deps,
		workstreamId,
		{
			phase: 'queued',
			step: null,
			needsYou: null,
			queuedAt: row.queuedAt ?? new Date(deps.now()).toISOString(),
			attempts: 0,
			failureSignature: null,
			...NO_SHIP_FAILURE,
		},
		undefined,
		'retry',
	);
	if (!saved) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
	return shipRecord(saved);
}

function retryNow(deps: ShipDeps, row: ShipRow): ShipStateRecord {
	clearAlarm(deps.context.db, shipAlarmKey(row.workstreamId));
	const saved = saveShip(deps, row.workstreamId, { nextAttemptAt: null }, row.phase, 'retry');
	return shipRecord(saved ?? row);
}

function keepWorkstream(deps: ShipDeps, workstreamId: string): ShipStateRecord {
	const row = getShip(deps.context.db, workstreamId);
	if (!row || (row.phase !== 'queued' && row.phase !== 'needs-you')) {
		throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
	}
	if (row.keep) return unchanged(deps, row, 'keep');
	return upsert(deps, workstreamId, 'keep', { keep: true });
}

async function cancel(deps: ShipDeps, workstreamId: string): Promise<ShipStateRecord | null> {
	const { db, commands } = deps.context;
	const row = getShip(db, workstreamId);
	if (!row) {
		emitClicked(deps.context, workstreamId, 'cancel', null);
		return null;
	}
	if (row.phase === 'local') return unchanged(deps, row, 'cancel');
	if (row.phase === 'draft') return cancelDraft(deps, row);
	const saved = saveShip(
		deps,
		workstreamId,
		{
			phase: row.pullRequestNumber === null ? 'local' : 'draft',
			step: null,
			keep: false,
			needsYou: null,
			queuedAt: null,
			attempts: 0,
			failureSignature: null,
			activeJobRunId: null,
			...NO_SHIP_FAILURE,
		},
		undefined,
		'cancel',
	);
	stopTrying(deps, workstreamId);
	if (row.activeJobRunId) {
		await commands.call('jobs.cancel-run', { jobRunId: row.activeJobRunId }).catch(() => undefined);
	}
	return saved ? shipRecord(saved) : null;
}

function cancelDraft(deps: ShipDeps, row: ShipRow): ShipStateRecord {
	if (row.step === null && !shipFailure(row)) return unchanged(deps, row, 'cancel');
	const saved = saveShip(
		deps,
		row.workstreamId,
		{
			...(row.pullRequestNumber === null ? { phase: 'local' } : {}),
			step: null,
			...NO_SHIP_FAILURE,
		},
		'draft',
		'cancel',
	);
	stopTrying(deps, row.workstreamId);
	return shipRecord(saved ?? row);
}

function stopTrying(deps: ShipDeps, workstreamId: string): void {
	clearShipRequests(deps.context.db, workstreamId);
	clearAlarm(deps.context.db, shipAlarmKey(workstreamId));
	deps.reader.watch(workstreamId);
}

async function refuseNothingToShip(deps: ShipDeps, target: ShipTarget): Promise<void> {
	const workstreamId = target.workstream.id;
	const totals = await deps.context.commands.call('repositories.workstream-change-totals', {
		workstreamId,
		baseBranch: target.base,
	});
	if (totals.files > 0) return;
	const existing = await deps.ops.status({
		repoId: target.repoId,
		workstreamId,
		head: target.workstream.branch,
		base: target.base,
	});
	if (existing.state === 'open') return;
	throw new ShipError('nothing-to-ship', 'This workstream has no changes to ship yet.');
}

function upsert(
	deps: ShipDeps,
	workstreamId: string,
	click: ShipButton | null,
	patch: ShipPatch,
): ShipStateRecord {
	const saved = updateShip(deps.context.db, workstreamId, patch);
	if (!saved) throw new ShipError('unknown-workstream', `Unknown workstream: ${workstreamId}`);
	const state = shipRecord(saved);
	if (click === null) {
		deps.context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId, state });
	} else emitClicked(deps.context, workstreamId, click, state);
	return state;
}

function unchanged(deps: ShipDeps, row: ShipRow, click: ShipButton | null): ShipStateRecord {
	const state = shipRecord(row);
	if (click !== null) emitClicked(deps.context, row.workstreamId, click, state);
	return state;
}

export function shipAllClicked(args: unknown): ShipAllClicked | null {
	const button = SHIP_ALL_BUTTONS.find((candidate) => candidate === field(args, 'button'));
	if (button === undefined) return null;
	return {
		workstreamId: requireString(args, 'workstreamId'),
		button,
		workstreamIds: requireStrings(args, 'workstreamIds'),
		chatSessionId:
			(field(args, 'chatSessionId') ?? null) === null ? null : requireString(args, 'chatSessionId'),
	};
}
