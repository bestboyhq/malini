import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import { shellRunsAggregate } from '$lib/chat/infrastructure/aggregates/shell-runs.aggregate.svelte';
import { shellRuns } from '$lib/chat/infrastructure/services/shell-runs.service';

export { dismissShellRunCommand };

function dismissShellRunCommand(runId: string): void {
	void (async () => {
		try {
			await shellRuns.dismiss(runId);
			shellRunsAggregate.dismissed(runId);
		} catch (error) {
			toast.error(`Could not dismiss the command · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
