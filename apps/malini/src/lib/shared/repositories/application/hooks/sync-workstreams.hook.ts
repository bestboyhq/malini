import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';

export function syncWorkstreamsHook(): () => void {
	const unlistenChanged = workstreamEventsService.onWorkstreamsChanged(() => {
		void workstreamsAggregate.refresh();
	});
	const unlistenRenamed = workstreamEventsService.onWorkstreamRenamed((workstreamId, name) => {
		workstreamsAggregate.rename(workstreamId, name);
	});
	return () => {
		unlistenChanged();
		unlistenRenamed();
	};
}
