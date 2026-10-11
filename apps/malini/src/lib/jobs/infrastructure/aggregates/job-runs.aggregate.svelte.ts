import type { JobRunRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class JobRunsAggregate {
	runs = $state.raw<readonly JobRunRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const runs = await jobsService.listRuns();
		if (generation !== this.#generation) return;
		this.runs = runs;
	}

	apply(run: JobRunRecord): void {
		this.runs = [run, ...this.runs.filter((existing) => existing.id !== run.id)];
	}

	forgetDefinition(definitionId: string): void {
		this.runs = this.runs.filter((run) => run.definitionId !== definitionId);
	}

	reset(): void {
		this.#generation += 1;
		this.runs = [];
	}
}

export const jobRunsAggregate = new JobRunsAggregate();
