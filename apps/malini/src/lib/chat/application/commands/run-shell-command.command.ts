import { toast } from '$hyper-ui/components/toast';
import type { RunShellCommandArgs } from '$contract/shell-runs';
import { errorMessage } from '$lib/chat/domain/error-message';
import { shellRunsAggregate } from '$lib/chat/infrastructure/aggregates/shell-runs.aggregate.svelte';
import { shellRuns } from '$lib/chat/infrastructure/services/shell-runs.service';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { runShellCommandCommand };

function runShellCommandCommand(args: RunShellCommandArgs): void {
	void (async () => {
		try {
			shellRunsAggregate.started(await shellRuns.run(args));
		} catch (error) {
			toast.error(
				`Could not run the command · ${errorMessage(error, 'unknown error')}`,
				aboutWorkstream(args.workstreamId),
			);
		}
	})();
}
