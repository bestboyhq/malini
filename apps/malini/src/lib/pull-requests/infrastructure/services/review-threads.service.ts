import type { AddressedReviewThreadsDto } from '$contract/repositories';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import { invoke } from '$shared/port/invoke';

class ReviewThreadsService {
	resolveAddressed(workstreamId: string, runId: string): Promise<AddressedReviewThreadsDto> {
		return invoke('pull-requests.resolve-addressed-review-threads', { workstreamId, runId }).catch(
			(error: unknown) => ({
				resolvedThreadIds: [],
				failures: [pullRequestActionFailureDetail(error, 'GitHub did not answer')],
			}),
		);
	}
}

export const reviewThreadsService = new ReviewThreadsService();
