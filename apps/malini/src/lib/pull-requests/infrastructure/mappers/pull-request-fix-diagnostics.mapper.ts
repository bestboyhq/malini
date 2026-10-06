import type { RepositoryPullRequestFixContext } from '@malini-extension/repository';
import type { PullRequestFixDiagnostics } from '$lib/pull-requests/domain/pull-request-fix-prompt';

type RawPullRequestFixContext = Pick<
	RepositoryPullRequestFixContext,
	'reviewFeedback' | 'checkDiagnostics'
>;

export class PullRequestFixDiagnosticsMapper {
	static fromRaw(raw: RawPullRequestFixContext): PullRequestFixDiagnostics {
		return { reviewFeedback: raw.reviewFeedback, checkDiagnostics: raw.checkDiagnostics };
	}
}
