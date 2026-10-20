class QueueErrorsStore {
	byId: Record<string, string> = $state({});

	set(id: string, message: string): void {
		this.byId = { ...this.byId, [id]: message };
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
