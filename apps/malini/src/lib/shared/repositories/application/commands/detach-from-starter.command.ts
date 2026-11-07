import { toast } from '$hyper-ui/components/toast';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { detachFromStarterCommand };

function detachFromStarterCommand(workstreamId: string): void {
	void (async () => {
		try {
			await workstreamsService.detachFromStarter(workstreamId);
		} catch (cause) {
			toast.error(
				`Could not disconnect · ${workstreamActionFailureMessage(cause, 'It still reports there.')}`,
			);
		}
		await workstreamsAggregate.refresh();
	})();
}
