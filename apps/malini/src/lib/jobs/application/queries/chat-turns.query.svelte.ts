import type { ChatTurnRecord } from '$contract/jobs';
import { chatTurnsAggregate } from '$lib/jobs/infrastructure/aggregates/chat-turns.aggregate.svelte';

export { chatTurnsQuery };

class ChatTurnsQuery {
	public readonly data: readonly ChatTurnRecord[] = $derived(chatTurnsAggregate.turns);
	public readonly every: boolean = $derived(chatTurnsAggregate.every);
}

const chatTurnsQuery = new ChatTurnsQuery();
