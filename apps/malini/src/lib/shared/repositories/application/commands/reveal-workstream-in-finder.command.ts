import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { revealWorkstreamInFinderCommand };

function revealWorkstreamInFinderCommand(workstreamId: string): void {
	void (async () => {
		try {
			await workstreamsService.revealInFinder(workstreamId);
		} catch {
			toast.error('Could not reveal the workstream', aboutWorkstream(workstreamId));
		}
	})();
}
