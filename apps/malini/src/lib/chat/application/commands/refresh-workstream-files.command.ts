import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';

export { refreshWorkstreamFilesCommand };

function refreshWorkstreamFilesCommand(workstreamId: string): void {
	const listing = workstreamFilesAggregate.listing;
	if (listing?.workstreamId !== workstreamId || listing.status !== 'ready') return;
	const read = workstreamFilesAggregate.startRead();
	void (async () => {
		try {
			const files = await workstreamFiles.list(workstreamId);
			workstreamFilesAggregate.settle({ workstreamId, status: 'ready', files }, read);
		} catch {
			return;
		}
	})();
}
