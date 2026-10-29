import type {
	ShipChangedEvent as RawShipChange,
	ShipStateRecord as RawShip,
} from '$contract/pull-requests';
import type {
	PullRequestShip,
	PullRequestShipChange,
} from '$lib/pull-requests/domain/pull-request-ship';

export class PullRequestShipMapper {
	static fromRawList(raws: readonly RawShip[]): readonly PullRequestShip[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawShip): PullRequestShip {
		return {
			workstreamId: raw.workstreamId,
			phase: raw.phase,
			step: raw.step,
			keep: raw.keep,
			pullRequestNumber: raw.pullRequestNumber,
			pullRequestUrl: raw.pullRequestUrl,
			needsYou: raw.needsYou,
			lastError: raw.lastError,
			githubSaid: raw.githubSaid,
			failures: raw.failures,
			failedSince: raw.failedSince,
			nextAttemptAt: raw.nextAttemptAt,
			waitsFor: raw.waitsFor,
			updatedAt: raw.updatedAt,
		};
	}

	static changeFromRaw(raw: RawShipChange): PullRequestShipChange {
		return {
			workstreamId: raw.workstreamId,
			ship: raw.state === null ? null : this.fromRaw(raw.state),
			mergedPullRequestNumber: raw.merged?.pullRequestNumber ?? null,
		};
	}
}
