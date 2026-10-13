import type { JobDefinitionRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class JobDefinitionsAggregate {
	definitions = $state.raw<readonly JobDefinitionRecord[]>([]);
	loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	loadError = $state<string | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		if (this.loadState !== 'ready') this.loadState = 'loading';
		try {
			const definitions = await jobsService.listDefinitions();
			if (generation !== this.#generation) return;
			this.definitions = definitions;
			this.loadState = 'ready';
			this.loadError = null;
		} catch (error) {
			if (generation !== this.#generation) return;
			this.loadState = 'error';
			this.loadError = error instanceof Error ? error.message : String(error);
		}
	}

	upsert(definition: JobDefinitionRecord): void {
		const known = this.definitions.some((existing) => existing.id === definition.id);
		this.definitions = known
			? this.definitions.map((existing) => (existing.id === definition.id ? definition : existing))
			: [...this.definitions, definition];
	}

	remove(definitionId: string): void {
		this.definitions = this.definitions.filter((definition) => definition.id !== definitionId);
	}

	reset(): void {
		this.#generation += 1;
		this.definitions = [];
		this.loadState = 'idle';
		this.loadError = null;
	}
}

export const jobDefinitionsAggregate = new JobDefinitionsAggregate();
