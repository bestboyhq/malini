import type { WorkstreamFileListing } from '$lib/chat/domain/workstream-file';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';

export { workstreamFileListingQuery };

class WorkstreamFileListingQuery {
	public readonly data: (workstreamId: string) => WorkstreamFileListing | null = $derived(
		(workstreamId: string) =>
			workstreamFilesAggregate.listing?.workstreamId === workstreamId
				? workstreamFilesAggregate.listing
				: null,
	);
}

const workstreamFileListingQuery = new WorkstreamFileListingQuery();
