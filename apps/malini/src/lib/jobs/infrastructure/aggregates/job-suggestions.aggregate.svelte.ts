import type { JobSuggestionRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class JobSuggestionsAggregate {
	suggestions = $state.raw<readonly JobSuggestionRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const suggestions = await jobsService.listSuggestions();
		if (generation !== this.#generation) return;
		this.suggestions = suggestions.filter((suggestion) => suggestion.status === 'open');
	}

	apply(suggestion: JobSuggestionRecord): void {
		const others = this.suggestions.filter((existing) => existing.id !== suggestion.id);
		this.suggestions = suggestion.status === 'open' ? [suggestion, ...others] : others;
	}

	reset(): void {
		this.#generation += 1;
		this.suggestions = [];
	}
}

export const jobSuggestionsAggregate = new JobSuggestionsAggregate();
