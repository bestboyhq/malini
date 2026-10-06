class RoutineActionsStore {
	busyIds = $state.raw<ReadonlySet<string>>(new Set());
	errors = $state.raw<Readonly<Record<string, string>>>({});
	draftsCreated = $state<number>(0);

	isBusy(id: string): boolean {
		return this.busyIds.has(id);
	}

	errorFor(id: string): string | null {
		return this.errors[id] ?? null;
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

	noteDraftCreated(): void {
		this.draftsCreated += 1;
	}

	async run(id: string, action: () => Promise<void>): Promise<void> {
		if (this.busyIds.has(id)) return;
		this.setBusy(id, true);
		this.clearError(id);
		try {
			await action();
		} catch (error) {
			this.setError(id, error instanceof Error ? error.message : String(error));
		} finally {
			this.setBusy(id, false);
		}
	}
}

export const routineActionsStore = new RoutineActionsStore();

export const ROUTINE_DRAFT_ACTION_ID = 'routines.draft';
