import {
	liveAutomations,
	liveAutomationsHere,
	type LiveAutomation,
} from '$lib/automations/domain/live-automations';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { workstreamLiveAutomationsQuery };

class WorkstreamLiveAutomationsQuery {
	public readonly data: (
		workstreamId: string,
		chatSessionId: string | null,
	) => readonly LiveAutomation[] = $derived((workstreamId: string, chatSessionId: string | null) =>
		liveAutomationsHere(
			liveAutomations(automationRunsAggregate.runs, reconcilerDecisionsAggregate.decisions),
			workstreamId,
			chatSessionId,
		),
	);
}

const workstreamLiveAutomationsQuery = new WorkstreamLiveAutomationsQuery();
