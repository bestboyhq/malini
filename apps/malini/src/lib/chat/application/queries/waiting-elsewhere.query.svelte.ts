import { waitingElsewhere, type AskingChild } from '$lib/chat/domain/child-requests';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { waitingElsewhereQuery };

class WaitingElsewhereQuery {
	public readonly data: (
		shownSessionId: string | null,
		children: readonly AskingChild[],
	) => AskingChild[] = $derived.by(() => {
		const sessions = sessionsAggregate.listSessions();
		return (shownSessionId, children) => waitingElsewhere(shownSessionId, children, sessions);
	});
}

const waitingElsewhereQuery = new WaitingElsewhereQuery();
