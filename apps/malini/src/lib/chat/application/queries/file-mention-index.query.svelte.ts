import { indexFileMentionPaths, type FileMentionIndex } from '$lib/chat/domain/file-mention-index';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';

export { fileMentionIndexQuery };

class FileMentionIndexQuery {
	public readonly data: (workstreamId: string) => FileMentionIndex | null = $derived.by(() => {
		const listing = workstreamFilesAggregate.listing;
		if (listing?.status !== 'ready') return () => null;
		const index = indexFileMentionPaths(listing.files.map(({ path }) => path));
		return (workstreamId: string) => (listing.workstreamId === workstreamId ? index : null);
	});
}

const fileMentionIndexQuery = new FileMentionIndexQuery();
