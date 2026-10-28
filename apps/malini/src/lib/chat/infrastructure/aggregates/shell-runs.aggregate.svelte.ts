import type { ShellRun } from '$contract/shell-runs';

class ShellRunsAggregate {
	runs: ReadonlyMap<string, ShellRun> = $state.raw(new Map());

	changed(run: ShellRun): void {
		const runs = new Map(this.runs);
		for (const [id, other] of runs) {
			if (id !== run.id && sameAnchor(other, run)) runs.delete(id);
		}
		this.runs = runs.set(run.id, run);
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

function sameAnchor(left: ShellRun, right: ShellRun): boolean {
	return left.anchor.message === right.anchor.message && left.anchor.block === right.anchor.block;
}

export const shellRunsAggregate = new ShellRunsAggregate();
