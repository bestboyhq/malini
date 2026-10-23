import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamDependencyInstall } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamSetup } from '$shared/repositories/infrastructure/aggregates/workstream-setup.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';

export function syncWorkstreamsHook(): () => void {
	const unlistenChanged = workstreamEventsService.onWorkstreamsChanged(() => {
		void workstreamsAggregate.refresh();
	});
	const unlistenRenamed = workstreamEventsService.onWorkstreamRenamed((workstreamId, name) => {
		workstreamsAggregate.rename(workstreamId, name);
	});
	const unlistenSetup = workstreamEventsService.onSetupStatus((payload) =>
		workstreamSetup.report(payload),
	);
	const unlistenInstall = workstreamEventsService.onInstallStatus((payload) =>
		workstreamDependencyInstall.report(payload),
	);
	const unlistenRepositories = workstreamEventsService.onRepositoriesChanged(() => {
		void repositoriesAggregate.refresh();
		void workstreamsAggregate.refresh();
	});
	return () => {
		unlistenChanged();
		unlistenRenamed();
		unlistenSetup();
		unlistenInstall();
		unlistenRepositories();
	};
}
