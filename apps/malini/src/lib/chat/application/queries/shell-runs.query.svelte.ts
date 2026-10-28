import type { ShellRun } from '$contract/shell-runs';
import { shellRunsAggregate } from '$lib/chat/infrastructure/aggregates/shell-runs.aggregate.svelte';

export { shellRunsQuery };

const NO_RUNS: ReadonlyMap<number, ShellRun> = new Map();

class ShellRunsQuery {
	public readonly data: (message: string) => ReadonlyMap<number, ShellRun> = $derived(
		(message: string) => {
			const runs = [...shellRunsAggregate.runs.values()].filter(
				(run) => run.anchor.message === message,
			);
			return runs.length === 0 ? NO_RUNS : new Map(runs.map((run) => [run.anchor.block, run]));
		},
	);
}

const shellRunsQuery = new ShellRunsQuery();
