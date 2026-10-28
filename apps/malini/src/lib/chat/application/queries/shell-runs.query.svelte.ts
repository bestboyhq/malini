import type { ShellRun } from '$contract/shell-runs';
import { shellRunsAggregate } from '$lib/chat/infrastructure/aggregates/shell-runs.aggregate.svelte';

export { shellRunsQuery };

class ShellRunsQuery {
	public readonly data: (sessionId: string | null) => readonly ShellRun[] = $derived(
		(sessionId: string | null) =>
			sessionId === null
				? []
				: [...shellRunsAggregate.runs.values()]
						.filter((run) => run.sessionId === sessionId)
						.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
	);
}

const shellRunsQuery = new ShellRunsQuery();
