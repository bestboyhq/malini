import type { Project } from '$shared/repositories/domain/repository';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { projectsQuery };

class ProjectsQuery {
	public readonly data: readonly Project[] = $derived(workstreamsAggregate.projects);
}

const projectsQuery = new ProjectsQuery();
