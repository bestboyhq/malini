import type { ChatTurnRecord } from '$contract/automations';
import { chatTurnsAggregate } from '$lib/automations/infrastructure/aggregates/chat-turns.aggregate.svelte';

export { chatTurnsQuery };

class ChatTurnsQuery {
	public readonly data: readonly ChatTurnRecord[] = $derived(chatTurnsAggregate.turns);
	public readonly every: boolean = $derived(chatTurnsAggregate.every);
}

const chatTurnsQuery = new ChatTurnsQuery();
