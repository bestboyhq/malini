import { startedProgressQuery } from '$lib/app/application/queries/started-progress.query.svelte';
import { standingLabel, type ProgressDot } from '$lib/app/domain/started-progress';
import type { StandingOf } from '$lib/initiatives/application/queries/initiatives.query.svelte';
import {
	pullRequestBadgesQuery,
	type PullRequestPhase,
} from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
import { pullRequestLinkQuery } from '$lib/pull-requests/application/queries/pull-request-link.query.svelte';
import {
	archivedWorkstreamsQuery,
	repositoryContextQuery,
	workstreamByIdQuery,
	workstreamNameQuery,
	type MergedPullRequest,
} from '$shared/repositories/repositories.api';

export { workstreamStandingQuery };

export type StandingLine = Readonly<{
	dot: ProgressDot;
	label: string;
	name: string;
	repositoryFullName: string | null;
	pullRequest: MergedPullRequest | null;
	phase: PullRequestPhase;
	savedForLater: boolean;
	archivedAt: number | null;
	open: boolean;
}>;

class WorkstreamStandingQuery {
	public readonly line: (workstreamId: string) => StandingLine | null = $derived(
		(workstreamId: string) => {
			const name = workstreamNameQuery.data(workstreamId) ?? '';
			const active = workstreamByIdQuery.data(workstreamId);
			if (active) {
				const dot = startedProgressQuery.dot(active);
				const phase = pullRequestBadgesQuery.data(workstreamId).phase;
				return {
					dot,
					label: standingLabel(dot, phase),
					name,
					repositoryFullName: repositoryContextQuery.data(workstreamId)?.repo.fullName ?? null,
					pullRequest: pullRequestLinkQuery.data(workstreamId),
					phase,
					savedForLater: false,
					archivedAt: null,
					open: true,
				};
			}
			const archived = archivedWorkstreamsQuery.data.find((entry) => entry.id === workstreamId);
			if (!archived) return null;
			const pullRequest = archived.mergedPullRequest;
			const archivedAt = Date.parse(archived.archivedAt);
			return {
				dot: pullRequest ? 'merged' : 'archived',
				label: pullRequest
					? `Merged #${pullRequest.number}`
					: archived.savedForLater
						? 'Saved for later'
						: 'Archived',
				name,
				repositoryFullName: archived.repositoryFullName,
				pullRequest,
				phase: pullRequest ? 'merged' : 'none',
				savedForLater: archived.savedForLater,
				archivedAt: Number.isNaN(archivedAt) ? null : archivedAt,
				open: false,
			};
		},
	);

	public readonly of: StandingOf = $derived((workstreamId: string) => {
		const line = this.line(workstreamId);
		if (!line) return null;
		return {
			dot: line.dot === 'blocked' ? 'needs' : line.dot,
			label: line.label,
			name: line.name,
			repositoryFullName: line.repositoryFullName,
			pullRequestNumber: line.pullRequest?.number ?? null,
			open: line.open,
		};
	});
}

const workstreamStandingQuery = new WorkstreamStandingQuery();
