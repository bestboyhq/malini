import type { BestboyProjects } from '$contract/stats';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

class ProjectsAggregate {
	projects = $state.raw<BestboyProjects | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const projects = await profileService.projects();
		if (generation !== this.#generation) return;
		this.projects = projects;
	}

	replace(projects: BestboyProjects): void {
		this.#generation += 1;
		this.projects = projects;
	}
}

export const projectsAggregate = new ProjectsAggregate();
