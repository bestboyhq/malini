import { toast } from '$hyper-ui/components/toast';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { clearMergedFromStarterCommand };

function clearMergedFromStarterCommand(workstreamIds: readonly string[]): void {
	void (async () => {
		try {
			await workstreamsService.clearMergedFromStarter(workstreamIds);
		} catch (cause) {
			toast.error(
				`Could not clear merged work · ${workstreamActionFailureMessage(cause, 'It stays listed.')}`,
			);
		}
		await workstreamsAggregate.refresh();
	})();
}
