import { handleProblem, normalizedHandle } from '$lib/stats/domain/handle';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';
import { publishFlowStore } from '$lib/stats/infrastructure/stores/publish-flow.store.svelte';

export { publishStatsCommand };

function publishStatsCommand(text: string): void {
	const handle = normalizedHandle(text);
	const problem = handleProblem(handle);
	if (problem) {
		publishFlowStore.fail(problem);
		return;
	}
	publishFlowStore.send();
	void (async () => {
		try {
			const result = await profileService.publish(handle);
			profileAggregate.replace(result.state);
			if (result.problem) publishFlowStore.fail(result.problem);
			else publishFlowStore.finish();
		} catch (error) {
			publishFlowStore.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
