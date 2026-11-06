import { isFinishedAutomationRunStatus } from '$lib/automations/domain/automation-run';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';

export { shippingAutomationRunsQuery };

class ShippingAutomationRunsQuery {
	public readonly workstreamIds: ReadonlySet<string> = $derived.by(() => {
		const shipping = new Set(
			automationDefinitionsAggregate.definitions
				.filter(({ builtin }) => builtin === 'open-draft' || builtin === 'merge')
				.map(({ id }) => id),
		);
		return new Set(
			automationRunsAggregate.runs.flatMap((run) =>
				run.workstreamId !== null &&
				shipping.has(run.definitionId) &&
				!isFinishedAutomationRunStatus(run.status)
					? [run.workstreamId]
					: [],
			),
		);
	});
}

const shippingAutomationRunsQuery = new ShippingAutomationRunsQuery();
