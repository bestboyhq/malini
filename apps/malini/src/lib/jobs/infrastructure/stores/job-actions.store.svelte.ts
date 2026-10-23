class JobActionsStore {
	busyIds = $state.raw<ReadonlySet<string>>(new Set());
	errors = $state.raw<Readonly<Record<string, string>>>({});

	isBusy(id: string): boolean {
		return this.busyIds.has(id);
	}

	errorFor(id: string): string | null {
		return this.errors[id] ?? null;
	}

	async run(id: string, action: () => Promise<void>): Promise<void> {
		if (this.busyIds.has(id)) return;
		this.#setBusy(id, true);
		this.#clearError(id);
		try {
			await action();
		} catch (error) {
			this.errors = {
				...this.errors,
				[id]: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.#setBusy(id, false);
		}
	}

	reset(): void {
		this.busyIds = new Set();
		this.errors = {};
	}

	#setBusy(id: string, busy: boolean): void {
		const next = new Set(this.busyIds);
		if (busy) next.add(id);
		else next.delete(id);
		this.busyIds = next;
	}

	#clearError(id: string): void {
		if (!(id in this.errors)) return;
		this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== id));
	}
}

export const jobActionsStore = new JobActionsStore();

export const JOB_FORM_ACTION_ID = 'jobs.form';
