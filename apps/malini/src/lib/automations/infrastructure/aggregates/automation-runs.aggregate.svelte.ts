import type { AutomationRunRecord } from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

class AutomationRunsAggregate {
	runs = $state.raw<readonly AutomationRunRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const runs = await automationsService.listRuns();
		if (generation !== this.#generation) return;
		this.runs = runs;
	}

	apply(run: AutomationRunRecord): void {
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

export const automationRunsAggregate = new AutomationRunsAggregate();
