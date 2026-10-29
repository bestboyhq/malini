import { shellRunsAggregate } from '$lib/chat/infrastructure/aggregates/shell-runs.aggregate.svelte';
import { shellRuns } from '$lib/chat/infrastructure/services/shell-runs.service';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export { watchShellRunsHook };

function watchShellRunsHook(): () => void {
	const unlisten = shellRuns.onChanged((run) => shellRunsAggregate.changed(run));
	void (async () => {
		try {
			shellRunsAggregate.loaded(await shellRuns.list());
		} catch (error) {
			captureRendererError('caught', error);
		}
	})();
	return unlisten;
}
