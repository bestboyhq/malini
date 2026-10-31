import type { Publishing } from '$contract/marketplace';

class PublishingAggregate {
	publishing = $state.raw<Publishing | null>(null);
	failure = $state.raw<string | null>(null);

	replace(publishing: Publishing): void {
		this.publishing = publishing;
		this.failure = null;
	}

	fail(failure: string): void {
		this.failure = failure;
	}
}

export const publishingAggregate = new PublishingAggregate();
