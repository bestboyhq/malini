import type { ContextMediaListing } from '$lib/chat/domain/context-media';

class ContextMediaAggregate {
	listing: ContextMediaListing | null = $state.raw(null);
	#latestRead = 0;

	needsLoad(workstreamId: string): boolean {
		return this.listing?.workstreamId !== workstreamId || this.listing.status === 'failed';
	}

	startRead(): number {
		this.#latestRead += 1;
		return this.#latestRead;
	}

	settle(listing: ContextMediaListing, read: number): void {
		if (read !== this.#latestRead || this.listing?.workstreamId !== listing.workstreamId) return;
		this.listing = listing;
	}
}

export const contextMediaAggregate = new ContextMediaAggregate();
