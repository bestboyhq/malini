import { projectsAggregate } from '$lib/stats/infrastructure/aggregates/projects.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export function watchProjectsHook(): () => void {
	return profileService.onProjectsChanged((projects) => projectsAggregate.replace(projects));
}
