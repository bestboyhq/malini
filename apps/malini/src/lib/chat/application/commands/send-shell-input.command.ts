import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import { shellRuns } from '$lib/chat/infrastructure/services/shell-runs.service';

export { sendShellInputCommand };

function sendShellInputCommand(runId: string, text: string): void {
	void (async () => {
		try {
			await shellRuns.write(runId, text);
		} catch (error) {
			toast.error(`Could not type into the command · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
