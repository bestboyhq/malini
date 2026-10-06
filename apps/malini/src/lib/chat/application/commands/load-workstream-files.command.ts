import { errorMessage } from '$lib/chat/domain/error-message';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';

export { loadWorkstreamFilesCommand };

function loadWorkstreamFilesCommand(workstreamId: string): void {
	if (!workstreamId || !workstreamFilesAggregate.needsLoad(workstreamId)) return;
	workstreamFilesAggregate.listing = { workstreamId, status: 'loading' };
	const read = workstreamFilesAggregate.startRead();
	void (async () => {
		try {
			const files = await workstreamFiles.list(workstreamId);
			workstreamFilesAggregate.settle({ workstreamId, status: 'ready', files }, read);
		} catch (error) {
			workstreamFilesAggregate.settle(
				{
					workstreamId,
					status: 'failed',
					error: errorMessage(error, 'Could not list workstream files'),
				},
				read,
			);
		}
	})();
}
