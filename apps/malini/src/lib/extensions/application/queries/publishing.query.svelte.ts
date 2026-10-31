import type { Publishing } from '$contract/marketplace';
import { publishingAggregate } from '$lib/extensions/infrastructure/aggregates/publishing.aggregate.svelte';

export { publishingQuery };

type PublishingListing = Readonly<{ publishing: Publishing | null; failure: string | null }>;

class PublishingQuery {
	public readonly data: PublishingListing = $derived({
		publishing: publishingAggregate.publishing,
		failure: publishingAggregate.failure,
	});
}

const publishingQuery = new PublishingQuery();
