import type { PullRequestActionInput } from '@malini-extension/repository';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { pullRequestAutomationEvidence } from '$lib/chat/infrastructure/services/pull-request-automation-context.service';

export { pullRequestEvidenceQuery };

class PullRequestEvidenceQuery {
	public readonly data: (
		workstreamId: string,
		requestedSessionId: string | null,
	) => PullRequestActionInput = $derived(
		(workstreamId: string, requestedSessionId: string | null) =>
			pullRequestAutomationEvidence({
				workstreamId,
				requestedSessionId,
				sessions: sessionsAggregate.listSessions(),
				eventsFor: (sessionId) => sessionsAggregate.listEventsFor(sessionId),
			}),
	);
}

const pullRequestEvidenceQuery = new PullRequestEvidenceQuery();
