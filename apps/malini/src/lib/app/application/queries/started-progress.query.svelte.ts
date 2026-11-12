import { progressDot, type ProgressDot } from '$lib/app/domain/started-progress';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
import {
	isWorkstreamCheckoutUsable,
	provisioningRecordQuery,
	workstreamSettingUpQuery,
	type Workstream,
} from '$shared/repositories/repositories.api';

class StartedProgressQuery {
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
}

export const startedProgressQuery = new StartedProgressQuery();
