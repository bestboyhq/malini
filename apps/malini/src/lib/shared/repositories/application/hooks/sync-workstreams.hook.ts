import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';

export function syncWorkstreamsHook(): () => void {
	const unlistenChanged = workstreamEventsService.onWorkstreamsChanged(() => {
		void workstreamsAggregate.refresh();
	});
	const unlistenRenamed = workstreamEventsService.onWorkstreamRenamed((workstreamId, name) => {
		workstreamsAggregate.rename(workstreamId, name);
	});
	const unlistenRepositories = workstreamEventsService.onRepositoriesChanged(() => {
		void repositoriesAggregate.refresh();
		void workstreamsAggregate.refresh();
	});
	return () => {
		unlistenChanged();
		unlistenRenamed();
		unlistenRepositories();
	};
}
