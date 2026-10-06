import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { openWorkstreamInEditorCommand };

function openWorkstreamInEditorCommand(workstreamId: string): void {
	void (async () => {
		try {
			await workstreamsService.openInEditor(workstreamId);
		} catch {
			toast.error('Could not open an editor', aboutWorkstream(workstreamId));
		}
	})();
}
