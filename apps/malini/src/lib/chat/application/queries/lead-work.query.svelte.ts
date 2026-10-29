import { activeWorkstreamsQuery } from '$shared/repositories/repositories.api';
import { workstreamChatSummaryQuery } from './workstream-chat-summary.query.svelte';

const WORKING_TONES: ReadonlySet<string> = new Set(['running', 'background']);

class LeadWorkQuery {
	public readonly started: (leadId: string) => readonly string[] = $derived((leadId: string) =>
		activeWorkstreamsQuery.data
			.filter((workstream) => workstream.startedBy === leadId && workstream.scope === null)
			.map((workstream) => workstream.id),
	);

	public readonly working: (leadId: string) => readonly string[] = $derived((leadId: string) =>
		this.started(leadId).filter((id) =>
			WORKING_TONES.has(workstreamChatSummaryQuery.data(id).state?.tone ?? ''),
		),
	);
}

export const leadWorkQuery = new LeadWorkQuery();
