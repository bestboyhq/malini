import { errorMessage } from '$lib/chat/domain/error-message';
import { contextMediaAggregate } from '$lib/chat/infrastructure/aggregates/context-media.aggregate.svelte';
import { contextMedia } from '$lib/chat/infrastructure/services/context-media.service';

export { loadContextMediaCommand };

function loadContextMediaCommand(workstreamId: string): void {
	if (!workstreamId) return;
	if (contextMediaAggregate.needsLoad(workstreamId)) {
		contextMediaAggregate.listing = { workstreamId, status: 'loading' };
	}
	const read = contextMediaAggregate.startRead();
	void (async () => {
		try {
			const media = await contextMedia.list(workstreamId);
			contextMediaAggregate.settle({ workstreamId, status: 'ready', media }, read);
		} catch (error) {
			if (contextMediaAggregate.listing?.status === 'ready') return;
			contextMediaAggregate.settle(
				{ workstreamId, status: 'failed', error: errorMessage(error, 'Could not list media') },
				read,
			);
		}
	})();
}
