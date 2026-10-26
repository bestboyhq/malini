import { PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL } from '$contract/events';
import { SHIP_BUTTONS, type ShipButton } from '$contract/pull-requests';
import type { PullRequestStatusDto } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { PullRequestsPlatform } from '../pull-requests.platform';
import { requireString } from './args';
import type { PullRequestOperations } from './pull-request-operations';
import { Shipping, type ShippingOptions } from './shipping.service';

export type ShipPlatform = PullRequestsPlatform &
	Readonly<{ report(workstreamId: string, pullRequest: PullRequestStatusDto): void }>;

export function registerShip(
	context: MainContext,
	operations: PullRequestOperations,
	options: ShippingOptions = {},
): ShipPlatform {
	const { commands, events } = context;
	const shipping = new Shipping(context, operations, options);
	const workstreamId = (args: unknown): string => requireString(args, 'workstreamId');

	commands.define('pull-requests.button-clicked', (args: unknown) =>
		shipping.clicked(workstreamId(args), button(args)),
	);
	commands.define('pull-requests.open-draft', (args: unknown) =>
		shipping.openDraft(workstreamId(args)),
	);
	commands.define('pull-requests.queue-merge', (args: unknown) =>
		shipping.queueMerge(workstreamId(args)),
	);
	commands.define('pull-requests.ship-states', () => shipping.states());
	commands.define('pull-requests.workstream-opened', (args: unknown) => {
		events.emit(PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL, { workstreamId: workstreamId(args) });
		return null;
	});

	return {
		report: (id, pullRequest) => shipping.report(id, pullRequest),
		handle: (event) => shipping.handle(event),
		dispose: () => shipping.dispose(),
	};
}

function button(args: unknown): ShipButton {
	const value = requireString(args, 'button');
	const known = SHIP_BUTTONS.find((candidate) => candidate === value);
	if (!known) throw new Error(`Unknown button: ${value}`);
	return known;
}
