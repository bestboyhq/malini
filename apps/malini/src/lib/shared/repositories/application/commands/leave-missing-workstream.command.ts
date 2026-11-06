import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';

export { leaveMissingWorkstreamCommand };

let checking: string | null = null;

function leaveMissingWorkstreamCommand(workstreamId: string): void {
	if (!workstreamId || checking === workstreamId) return;
	if (!workstreamsAggregate.loaded || known(workstreamId)) return;
	checking = workstreamId;
	void (async () => {
		try {
			await workstreamsAggregate.refresh();
			if (known(workstreamId) || page.params.workstreamId !== workstreamId) return;
			await goto(REPOSITORIES_HREF, { replaceState: true });
		} finally {
			checking = null;
		}
	})();
}

function known(workstreamId: string): boolean {
	return workstreamsAggregate.workstreams.some((workstream) => workstream.id === workstreamId);
}
