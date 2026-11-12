import type { SetProjectArgs } from '$contract/stats';
import { toast } from '$hyper-ui/components/toast';
import { projectsAggregate } from '$lib/stats/infrastructure/aggregates/projects.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { setProjectCommand };

function setProjectCommand(project: SetProjectArgs): void {
	void (async () => {
		try {
			projectsAggregate.replace(await profileService.setProject(project));
		} catch (error) {
			toast.error(
				`Could not save your project · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
