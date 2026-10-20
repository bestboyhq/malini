class RunStartsStore {
	startedAtByRun: Record<string, number> = $state({});

	observe(runId: string, atMs: number): void {
		if (runId in this.startedAtByRun) return;
		this.startedAtByRun = { ...this.startedAtByRun, [runId]: atMs };
	}
}

export const runStartsStore = new RunStartsStore();
