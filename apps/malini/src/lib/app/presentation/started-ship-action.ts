import type { ShipAllButton } from '$contract/pull-requests';
import { shipAllCommand } from '$lib/pull-requests/application/commands/ship-all.command';
import type { GlobalTopBarStatusAction } from '$shared/shell/global-topbar-actions.svelte';

const SHIP_ACTIONS = {
	'draft-all': {
		label: 'Draft all',
		ariaLabel: 'Open draft pull requests in',
		tone: 'secondary',
		icon: 'pr-draft',
	},
	'merge-all': { label: 'Merge all', ariaLabel: 'Merge', tone: 'primary', icon: 'pr-merged' },
} as const satisfies Record<ShipAllButton, object>;

export function startedShipAction(
	button: ShipAllButton,
	workstreamId: string,
	workstreamIds: readonly string[],
	chatSessionId: () => string | null,
): GlobalTopBarStatusAction | null {
	if (workstreamIds.length === 0) return null;
	const { ariaLabel, ...shown } = SHIP_ACTIONS[button];
	const count = workstreamIds.length;
	return {
		...shown,
		ariaLabel: `${ariaLabel} ${count} ${count === 1 ? 'workstream' : 'workstreams'}`,
		disabled: false,
		onInvoke: () => shipAllCommand(button, workstreamId, workstreamIds, chatSessionId()),
	};
}
