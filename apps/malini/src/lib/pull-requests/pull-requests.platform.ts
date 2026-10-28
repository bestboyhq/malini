import type { ShippingRule } from '$lib/jobs/jobs.platform';

export type {
	CheckAnnotationDto,
	CheckDiagnosticsDto,
	CheckRunDiagnosticDto,
	CommitStatusDiagnosticDto,
	GhRunner,
	PullRequestCheckDto,
	PullRequestStatusDto,
	PullRequestView,
	RequestedChangeReviewDto,
	ReviewCommentDto,
	ReviewFeedbackDto,
	ReviewThreadDto,
} from './platform/pull-requests.service';
export {
	aggregateChecksState,
	mapChecks,
	mapPullRequestStatus,
} from './platform/pull-requests.service';

export interface PullRequestsPlatform {
	readonly shipping: ShippingRule;
	dispose(): void;
}
