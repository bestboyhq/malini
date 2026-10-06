import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';

const RETAINED_SETTLED_REQUESTS = 200;

type SettledOutcome = Exclude<ChatRequestOutcome, { status: 'pending' }>;

class ChatRequestsStore {
	outcomes: Record<ChatRequestId, ChatRequestOutcome> = $state({});
	#waiters = new Map<ChatRequestId, Array<(outcome: SettledOutcome) => void>>();
	#settledOrder: ChatRequestId[] = [];

	begin(requestId: ChatRequestId): void {
		this.outcomes = { ...this.outcomes, [requestId]: { status: 'pending' } };
	}

	accept(requestId: ChatRequestId): void {
		this.#settle(requestId, { status: 'accepted' });
	}

	fail(requestId: ChatRequestId, error: string): void {
		this.#settle(requestId, { status: 'failed', error });
	}

	settled(requestId: ChatRequestId): Promise<SettledOutcome> {
		const current = this.outcomes[requestId];
		if (current && current.status !== 'pending') return Promise.resolve(current);
		return new Promise((resolve) => {
			this.#waiters.set(requestId, [...(this.#waiters.get(requestId) ?? []), resolve]);
		});
	}

	reset(): void {
		this.outcomes = {};
		this.#settledOrder = [];
	}

	#settle(requestId: ChatRequestId, outcome: SettledOutcome): void {
		const next: Record<ChatRequestId, ChatRequestOutcome> = {
			...this.outcomes,
			[requestId]: outcome,
		};
		this.#settledOrder.push(requestId);
		while (this.#settledOrder.length > RETAINED_SETTLED_REQUESTS) {
			const evicted = this.#settledOrder.shift();
			if (evicted !== undefined && next[evicted]?.status !== 'pending') delete next[evicted];
		}
		this.outcomes = next;
		const waiters = this.#waiters.get(requestId) ?? [];
		this.#waiters.delete(requestId);
		for (const resolve of waiters) resolve(outcome);
	}
}

export const chatRequestsStore = new ChatRequestsStore();
