class QueueSendingStore {
	byWorkstream: Record<string, string | null> = $state({});

	idFor(workstreamId: string): string | null {
		return this.byWorkstream[workstreamId] ?? null;
	}

	set(workstreamId: string, id: string | null): void {
		if (this.idFor(workstreamId) === id) return;
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: id };
	}

	release(workstreamId: string, id: string | undefined): void {
		if (!id || this.byWorkstream[workstreamId] !== id) return;
		this.set(workstreamId, null);
	}

	reset(): void {
		this.byWorkstream = {};
	}
}

export const queueSendingStore = new QueueSendingStore();
