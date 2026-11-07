import type { AutomationRunRecord } from '$contract/automations';
import { isFinishedAutomationRunStatus } from '$lib/automations/domain/automation-run';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';

export { workstreamAutomationRunsQuery };

const RECENT_MS = 10 * 60 * 1_000;

class WorkstreamAutomationRunsQuery {
	public readonly data: (workstreamId: string, nowMs: number) => readonly AutomationRunRecord[] =
		$derived((workstreamId: string, nowMs: number) =>
			automationRunsAggregate.runs
				.filter(
					(run) =>
						run.workstreamId === workstreamId &&
						isFinishedAutomationRunStatus(run.status) &&
						nowMs - Date.parse(run.finishedAt ?? run.createdAt) < RECENT_MS,
				)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
		);
}

const workstreamAutomationRunsQuery = new WorkstreamAutomationRunsQuery();
