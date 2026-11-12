import type { SetProjectArgs } from '$contract/stats';
import { toast } from '$hyper-ui/components/toast';
import { loadProjectsCommand } from '$lib/stats/application/commands/load-projects.command';
import { projectsAggregate } from '$lib/stats/infrastructure/aggregates/projects.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { setProjectCommand };

function setProjectCommand(project: SetProjectArgs): void {
	projectsAggregate.turn(project.repositoryId, project.on);
	void (async () => {
		try {
			projectsAggregate.replace(await profileService.setProject(project));
		} catch (error) {
			toast.error(
				`Could not save your project · ${error instanceof Error ? error.message : String(error)}`,
			);
			loadProjectsCommand();
		}
	})();
}
