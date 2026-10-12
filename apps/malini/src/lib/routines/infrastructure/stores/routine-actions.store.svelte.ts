class RoutineActionsStore {
	busyIds = $state.raw<ReadonlySet<string>>(new Set());
	errors = $state.raw<Readonly<Record<string, string>>>({});
	completions = $state.raw<Readonly<Record<string, number>>>({});

	isBusy(id: string): boolean {
		return this.busyIds.has(id);
	}

	errorFor(id: string): string | null {
		return this.errors[id] ?? null;
	}

	completedFor(id: string): number {
		return this.completions[id] ?? 0;
	}

	setBusy(id: string, busy: boolean): void {
		const next = new Set(this.busyIds);
		if (busy) next.add(id);
		else next.delete(id);
		this.busyIds = next;
	}

	setError(id: string, message: string): void {
		this.errors = { ...this.errors, [id]: message };
	}

	clearError(id: string): void {
		if (!(id in this.errors)) return;
		const rest = { ...this.errors };
		delete rest[id];
		this.errors = rest;
	}

	async run(id: string, action: () => Promise<void>): Promise<void> {
		if (this.busyIds.has(id)) return;
		this.setBusy(id, true);
		this.clearError(id);
		try {
			await action();
			this.completions = { ...this.completions, [id]: this.completedFor(id) + 1 };
		} catch (error) {
			this.setError(id, error instanceof Error ? error.message : String(error));
		} finally {
			this.setBusy(id, false);
		}
	}
}

export const routineActionsStore = new RoutineActionsStore();
