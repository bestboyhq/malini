import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';

const RETAINED_SETTLED_REQUESTS = 200;

type SettledOutcome = Exclude<ChatRequestOutcome, { status: 'pending' }>;

class ChatRequestsStore {
	outcomes: Record<ChatRequestId, ChatRequestOutcome> = $state({});
	#waiters = new Map<ChatRequestId, Array<(outcome: SettledOutcome) => void>>();
	#settledOrder: ChatRequestId[] = [];
	#landings = new Map<ChatRequestId, string>();

	begin(requestId: ChatRequestId): void {
		this.outcomes = { ...this.outcomes, [requestId]: { status: 'pending' } };
	}

	accept(requestId: ChatRequestId): void {
		this.#settle(requestId, { status: 'accepted' });
	}

	fail(requestId: ChatRequestId, error: string): void {
		this.#settle(requestId, { status: 'failed', error });
	}

	land(requestId: ChatRequestId, sessionId: string): void {
		this.#landings.set(requestId, sessionId);
	}

	takeLanding(requestId: ChatRequestId): string | null {
		const sessionId = this.#landings.get(requestId) ?? null;
		this.#landings.delete(requestId);
		return sessionId;
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
		this.#landings.clear();
	}

	#settle(requestId: ChatRequestId, outcome: SettledOutcome): void {
		const next: Record<ChatRequestId, ChatRequestOutcome> = {
			...this.outcomes,
			[requestId]: outcome,
		};
		this.#settledOrder.push(requestId);
		while (this.#settledOrder.length > RETAINED_SETTLED_REQUESTS) {
			const evicted = this.#settledOrder.shift();
			if (evicted === undefined || next[evicted]?.status === 'pending') continue;
			delete next[evicted];
			this.#landings.delete(evicted);
		}
		this.outcomes = next;
		if (outcome.status === 'accepted') this.#landings.delete(requestId);
		const waiters = this.#waiters.get(requestId) ?? [];
		this.#waiters.delete(requestId);
		for (const resolve of waiters) resolve(outcome);
	}
}

export const chatRequestsStore = new ChatRequestsStore();
