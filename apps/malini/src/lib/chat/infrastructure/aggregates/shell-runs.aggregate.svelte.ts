import type { ShellRun } from '$contract/shell-runs';

class ShellRunsAggregate {
	runs: ReadonlyMap<string, ShellRun> = $state.raw(new Map());

	changed(run: ShellRun): void {
		this.runs = new Map(this.runs).set(run.id, run);
	}

	started(run: ShellRun): void {
		if (!this.runs.has(run.id)) this.changed(run);
	}

	loaded(runs: readonly ShellRun[]): void {
		for (const run of runs) this.started(run);
	}

	dismissed(runId: string): void {
		const runs = new Map(this.runs);
		runs.delete(runId);
		this.runs = runs;
	}
}

export const shellRunsAggregate = new ShellRunsAggregate();
