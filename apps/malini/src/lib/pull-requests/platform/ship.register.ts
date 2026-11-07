import {
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
} from '$contract/events';
import { SHIP_BUTTONS, type ShipButton } from '$contract/pull-requests';
import type { PullRequestStatusDto } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { PullRequestChef } from '$shared/repositories/repositories.platform';
import type { PullRequestsPlatform } from '../pull-requests.platform';
import { shipFailure } from '../domain/ship-failure';
import { DEFAULT_SHIP_DELAYS, type ShipDelays } from '../domain/shipping';
import { requireString } from './args';
import type { PullRequestOperations } from './pull-request-operations';
import { PullRequestReader } from './pull-request-reader.service';
import { clickShip, openDraft, queueMerge, shipAllClicked } from './ship-intents';
import { getShip, listShips, shipRecord } from './ship.repository';
import { createShippingRule } from './ship-rule';
import { dropShip, type ShipDeps } from './ship-store';

export interface ShippingOptions {
	delays?: Partial<ShipDelays>;
	now?: () => number;
	chef?: () => Promise<PullRequestChef | null>;
}

export type ShipPlatform = PullRequestsPlatform &
	Readonly<{
		report(
			workstreamId: string,
			read: () => Promise<PullRequestStatusDto>,
		): Promise<PullRequestStatusDto>;
	}>;

export function registerShip(
	context: MainContext,
	operations: PullRequestOperations,
	options: ShippingOptions = {},
): ShipPlatform {
	const { commands, events, db } = context;
	let running = true;
	const delays: ShipDelays = { ...DEFAULT_SHIP_DELAYS, ...options.delays };
	const now = options.now ?? Date.now;
	const deps: ShipDeps = {
		context,
		ops: operations,
		delays,
		now,
		running: () => running,
		starting: new Map(),
		...(options.chef ? { chef: options.chef } : {}),
		reader: new PullRequestReader(context, operations, delays, now, (id) =>
			pullRequestGone(deps, id),
		),
	};
	const workstreamId = (args: unknown): string => requireString(args, 'workstreamId');

	commands.define('pull-requests.button-clicked', (args: unknown) => {
		const all = shipAllClicked(args);
		if (all === null) return clickShip(deps, workstreamId(args), button(args));
		events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, all);
		return null;
	});
	commands.define('pull-requests.open-draft', (args: unknown) =>
		openDraft(deps, workstreamId(args)),
	);
	commands.define('pull-requests.queue-merge', (args: unknown) =>
		queueMerge(deps, workstreamId(args)),
	);
	commands.define('pull-requests.ship-states', () => listShips(db).map(shipRecord));
	commands.define('pull-requests.workstream-opened', (args: unknown) => {
		events.emit(PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL, { workstreamId: workstreamId(args) });
		return null;
	});

	return {
		report: (id, read) => deps.reader.report(id, read),
		shipping: createShippingRule(deps),
		failure: (id) => shipFailure(getShip(db, id)),
		dispose: () => {
			running = false;
			deps.reader.dispose();
		},
	};
}

function pullRequestGone(deps: ShipDeps, workstreamId: string): void {
	const row = getShip(deps.context.db, workstreamId);
	if (row?.phase !== 'draft' || row.step !== null || row.pullRequestNumber === null) return;
	dropShip(deps, workstreamId);
	deps.context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId, state: null });
}

function button(args: unknown): ShipButton {
	const value = requireString(args, 'button');
	const known = SHIP_BUTTONS.find((candidate) => candidate === value);
	if (!known) throw new Error(`Unknown button: ${value}`);
	return known;
}
