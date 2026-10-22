import {
	imageChanges,
	imageComparisonKey,
	type ImageComparisonRequest,
} from '$lib/chat/domain/image-changes';
import { imageComparisonsAggregate } from '$lib/chat/infrastructure/aggregates/image-comparisons.aggregate.svelte';
import { imagePixels } from '$lib/chat/infrastructure/services/image-pixels.service';

export { compareImagesCommand };

function compareImagesCommand(request: ImageComparisonRequest): void {
	const key = imageComparisonKey(request);
	if (imageComparisonsAggregate.stateOf(key)) return;
	imageComparisonsAggregate.set(key, { status: 'loading' });
	void (async () => {
		try {
			const [before, after] = await Promise.all([
				imagePixels.read(request.workstreamId, request.before),
				imagePixels.read(request.workstreamId, request.after),
			]);
			const changes = before && after ? imageChanges(before, after) : null;
			if (!changes) {
				imageComparisonsAggregate.set(key, { status: 'unavailable' });
				return;
			}
			imageComparisonsAggregate.set(key, {
				status: 'ready',
				width: changes.width,
				height: changes.height,
				areas: changes.areas,
				maskUrl: await imagePixels.maskUrl(changes),
			});
		} catch {
			imageComparisonsAggregate.set(key, { status: 'unavailable' });
		}
	})();
}
