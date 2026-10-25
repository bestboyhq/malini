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

	public readonly merged: ReadonlyMap<string, number> = $derived(
		archivedWorkstreamsQuery.data.reduce((merged, workstream) => {
			if (workstream.startedBy === null || workstream.mergedPullRequest === null) return merged;
			return merged.set(workstream.startedBy, (merged.get(workstream.startedBy) ?? 0) + 1);
		}, new Map<string, number>()),
	);

	public readonly dots: (parentId: string) => ProgressDot[] = $derived((parentId: string) => [
		...Array.from({ length: this.merged.get(parentId) ?? 0 }, (): ProgressDot => 'merged'),
		...activeWorkstreamsQuery.data
			.filter((workstream) => workstream.startedBy === parentId && workstream.scope === null)
			.map((workstream) => this.dot(workstream)),
	]);

	public readonly startedIds: (parentId: string) => string[] = $derived((parentId: string) =>
		[...activeWorkstreamsQuery.data, ...archivedWorkstreamsQuery.data]
			.filter((workstream) => workstream.startedBy === parentId && workstream.scope === null)
			.map((workstream) => workstream.id),
	);
}

export const leadProgressQuery = new LeadProgressQuery();
