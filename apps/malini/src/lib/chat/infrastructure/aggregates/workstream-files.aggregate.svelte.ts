import type { WorkstreamFile, WorkstreamFileListing } from '$lib/chat/domain/workstream-file';

class WorkstreamFilesAggregate {
	listing: WorkstreamFileListing | null = $state.raw(null);
	#latestRead = 0;

	needsLoad(workstreamId: string): boolean {
		return this.listing?.workstreamId !== workstreamId || this.listing.status === 'failed';
	}

	startRead(): number {
		this.#latestRead += 1;
		return this.#latestRead;
	}

	settle(listing: WorkstreamFileListing, read: number): void {
		const current = this.listing;
		if (read !== this.#latestRead || current?.workstreamId !== listing.workstreamId) return;
		if (current.status === 'ready' && listing.status === 'ready') {
			if (sameFiles(current.files, listing.files)) return;
		}
		this.listing = listing;
	}

	reset(): void {
		this.listing = null;
		this.#latestRead = 0;
	}
}

function sameFiles(left: readonly WorkstreamFile[], right: readonly WorkstreamFile[]): boolean {
	return (
		left.length === right.length && left.every((file, index) => file.path === right[index]?.path)
	);
}

export const workstreamFilesAggregate = new WorkstreamFilesAggregate();
