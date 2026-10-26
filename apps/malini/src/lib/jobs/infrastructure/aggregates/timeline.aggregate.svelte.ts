import type { TimelineRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class TimelineAggregate {
	record = $state.raw<TimelineRecord | null>(null);
	error = $state<string | null>(null);

	#generation = 0;

	async load(since: string): Promise<void> {
		const generation = ++this.#generation;
		try {
			const record = await jobsService.listTimeline(since);
			if (generation !== this.#generation) return;
			this.record = record;
			this.error = null;
		} catch (error) {
			if (generation !== this.#generation) return;
			this.error = error instanceof Error ? error.message : String(error);
		}
	}
}

export const timelineAggregate = new TimelineAggregate();
