import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import { shellRuns } from '$lib/chat/infrastructure/services/shell-runs.service';

export { stopShellRunCommand };

function stopShellRunCommand(runId: string): void {
	void (async () => {
		try {
			await shellRuns.stop(runId);
		} catch (error) {
			toast.error(`Could not stop the command · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
