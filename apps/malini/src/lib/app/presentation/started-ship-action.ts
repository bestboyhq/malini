import { runShippingJobCommand } from '$lib/jobs/application/commands/run-shipping-job.command';
import type { GlobalTopBarStatusAction } from '$shared/shell/global-topbar-actions.svelte';

const SHIP_ACTIONS = {
	'open-draft': {
		label: 'Draft all',
		ariaLabel: 'Open draft pull requests in',
		tone: 'secondary',
		icon: 'pr-draft',
	},
	merge: { label: 'Merge all', ariaLabel: 'Merge', tone: 'primary', icon: 'pr-merged' },
} as const;

export function startedShipAction(
	builtin: keyof typeof SHIP_ACTIONS,
	workstreamIds: readonly string[],
	chatSessionId: () => string | null,
): GlobalTopBarStatusAction | null {
	if (workstreamIds.length === 0) return null;
	const { ariaLabel, ...shown } = SHIP_ACTIONS[builtin];
	const count = workstreamIds.length;
	return {
		...shown,
		ariaLabel: `${ariaLabel} ${count} ${count === 1 ? 'workstream' : 'workstreams'}`,
		disabled: false,
		onInvoke: () => runShippingJobCommand(builtin, workstreamIds, chatSessionId()),
	};
}
