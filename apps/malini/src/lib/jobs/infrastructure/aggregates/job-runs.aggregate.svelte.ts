import type { JobRunRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class JobRunsAggregate {
	runs = $state.raw<readonly JobRunRecord[]>([]);

	#generation = 0;
	#resets = 0;
	#chatLoads = new Map<string, Promise<void>>();

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const runs = await jobsService.listRuns();
		if (generation !== this.#generation) return;
		const loaded = new Set(runs.map((run) => run.id));
		this.runs = [
			...runs,
			...this.runs.filter((run) => run.chatSessionId !== null && !loaded.has(run.id)),
		];
	}

	loadChat(chatSessionId: string): Promise<void> {
		const inFlight = this.#chatLoads.get(chatSessionId);
		if (inFlight) return inFlight;
		const loading = this.#fetchChat(chatSessionId);
		this.#chatLoads.set(chatSessionId, loading);
		return loading;
	}

	async #fetchChat(chatSessionId: string): Promise<void> {
		const resets = this.#resets;
		try {
			const runs = await jobsService.listChatRuns(chatSessionId);
			if (resets !== this.#resets) return;
			const known = new Set(this.runs.map((run) => run.id));
			this.runs = [...this.runs, ...runs.filter((run) => !known.has(run.id))];
		} finally {
			if (resets === this.#resets) this.#chatLoads.delete(chatSessionId);
		}
	}

	apply(run: JobRunRecord): void {
		this.runs = [run, ...this.runs.filter((existing) => existing.id !== run.id)];
	}

	forgetDefinition(definitionId: string): void {
		this.runs = this.runs.filter((run) => run.definitionId !== definitionId);
	}

	reset(): void {
		this.#generation += 1;
		this.#resets += 1;
		this.#chatLoads.clear();
		this.runs = [];
	}
}

export const jobRunsAggregate = new JobRunsAggregate();
