import { projectsAggregate } from '$lib/stats/infrastructure/aggregates/projects.aggregate.svelte';

export { loadProjectsCommand };

function loadProjectsCommand(): void {
	void (async () => {
		try {
			await projectsAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not list your projects on Bestboy', error);
		}
	})();
}
