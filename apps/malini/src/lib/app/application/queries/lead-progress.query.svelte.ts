import { progressDot, type ProgressDot } from '$lib/app/domain/lead-progress';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
import {
	activeWorkstreamsQuery,
	archivedWorkstreamsQuery,
	isWorkstreamCheckoutUsable,
	provisioningRecordQuery,
	workstreamSettingUpQuery,
	type Workstream,
} from '$shared/repositories/repositories.api';

class LeadProgressQuery {
	public readonly dot: (workstream: Workstream) => ProgressDot = $derived(
		(workstream: Workstream) => {
			const chat = workstreamChatSummaryQuery.data(workstream.id);
			const provisioning = provisioningRecordQuery.data(workstream.id);
			const starting = provisioning !== null || workstreamSettingUpQuery.data(workstream.id);
			const tone = chat.state?.tone ?? null;
			return progressDot({
				merged: false,
				pullRequest: pullRequestBadgesQuery.data(workstream.id).phase,
				needsYou: chat.needsYou,
				chatTone: tone,
				busy: starting || tone === 'running' || tone === 'background',
				broken:
					provisioning?.failure !== undefined ||
					(!starting && !isWorkstreamCheckoutUsable(workstream)),
			});
		},
	);

	public readonly dots: (parentId: string) => ProgressDot[] = $derived((parentId: string) => [
		...activeWorkstreamsQuery.data
			.filter(startedBy(parentId))
			.map((workstream) => this.dot(workstream)),
		...archivedWorkstreamsQuery.data
			.filter(startedBy(parentId))
			.map((workstream): ProgressDot => (workstream.mergedPullRequest ? 'merged' : 'archived')),
	]);

	public readonly startedIds: (parentId: string) => string[] = $derived((parentId: string) =>
		[...activeWorkstreamsQuery.data, ...archivedWorkstreamsQuery.data]
			.filter(startedBy(parentId))
			.map((workstream) => workstream.id),
	);
}

function startedBy(
	parentId: string,
): (workstream: Readonly<{ startedBy: string | null; scope: unknown }>) => boolean {
	return (workstream) => workstream.startedBy === parentId && workstream.scope === null;
}

export const leadProgressQuery = new LeadProgressQuery();
