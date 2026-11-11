import type { QueueNote } from '$lib/chat/domain/queued-prompt';

class QueueErrorsStore {
	byId: Record<string, QueueNote> = $state({});

	set(id: string, message: string, waiting = false): void {
		this.byId = { ...this.byId, [id]: { message, waiting } };
	}

	clear(id: string | undefined): void {
		if (!id || !(id in this.byId)) return;
		const { [id]: _cleared, ...rest } = this.byId;
		this.byId = rest;
	}

	reset(): void {
		this.byId = {};
	}
}

export const queueErrorsStore = new QueueErrorsStore();
