import { waitingElsewhere, type AskingChat } from '$lib/chat/domain/requests-elsewhere';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { waitingElsewhereQuery };

class WaitingElsewhereQuery {
	public readonly data: (
		shownSessionId: string | null,
		asking: readonly AskingChat[],
	) => AskingChat[] = $derived.by(() => {
		const sessions = sessionsAggregate.listSessions();
		return (shownSessionId, asking) => waitingElsewhere(shownSessionId, asking, sessions);
	});
}

const waitingElsewhereQuery = new WaitingElsewhereQuery();
