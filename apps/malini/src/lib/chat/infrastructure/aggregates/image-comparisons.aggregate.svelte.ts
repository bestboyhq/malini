import type { ImageComparison } from '$lib/chat/domain/image-changes';

class ImageComparisonsAggregate {
	comparisons = $state.raw<Readonly<Record<string, ImageComparison>>>({});

	stateOf(key: string): ImageComparison | null {
		return this.comparisons[key] ?? null;
	}

	set(key: string, comparison: ImageComparison): void {
		this.comparisons = { ...this.comparisons, [key]: comparison };
	}
}

export const imageComparisonsAggregate = new ImageComparisonsAggregate();
