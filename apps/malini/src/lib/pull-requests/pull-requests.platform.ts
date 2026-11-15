import { PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL } from '$contract/events';
import type { ShipFailure } from '$contract/pull-requests';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord } from '$main/db/rows';
import { latestLoggedEvent, type ShippingRule } from '$lib/automations/automations.platform';
import { getShip } from './platform/ship.repository';

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
	failure(workstreamId: string): ShipFailure | null;
	dispose(): void;
}

export function hasOpenDraft(db: MaliniDatabase, workstreamId: string): boolean {
	const ship = getShip(db, workstreamId);
	if (ship?.phase !== 'draft' || ship.pullRequestNumber === null) return false;
	const read = latestLoggedEvent(
		db,
		PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
		workstreamId,
	)?.payload;
	return (
		isRecord(read) &&
		read['state'] === 'draft' &&
		read['pullRequestNumber'] === ship.pullRequestNumber
	);
}
