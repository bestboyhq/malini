import type { BestboyProjects } from '$contract/stats';
import { projectsAggregate } from '$lib/stats/infrastructure/aggregates/projects.aggregate.svelte';

export { projectsQuery };

class ProjectsQuery {
	public readonly data: BestboyProjects | null = $derived(projectsAggregate.projects);
}

const projectsQuery = new ProjectsQuery();
