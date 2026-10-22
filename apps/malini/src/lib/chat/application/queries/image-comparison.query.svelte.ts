import {
	imageComparisonKey,
	type ImageComparison,
	type ImageComparisonRequest,
} from '$lib/chat/domain/image-changes';
import { imageComparisonsAggregate } from '$lib/chat/infrastructure/aggregates/image-comparisons.aggregate.svelte';

export { imageComparisonQuery };

class ImageComparisonQuery {
	public readonly data: (request: ImageComparisonRequest) => ImageComparison = $derived(
		(request: ImageComparisonRequest) =>
			imageComparisonsAggregate.stateOf(imageComparisonKey(request)) ?? { status: 'loading' },
	);
}

const imageComparisonQuery = new ImageComparisonQuery();
