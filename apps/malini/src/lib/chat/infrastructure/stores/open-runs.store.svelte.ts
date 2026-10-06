class OpenRunsStore {
	openByWorkstream: Record<string, boolean> = $state({});
	readonly #revisions = new Map<string, number>();

	begin(workstreamId: string): number {
		const revision = (this.#revisions.get(workstreamId) ?? 0) + 1;
		this.#revisions.set(workstreamId, revision);
		return revision;
	}

	settle(workstreamId: string, revision: number, open: boolean): void {
		if (this.#revisions.get(workstreamId) !== revision) return;
		if (this.openByWorkstream[workstreamId] === open) return;
		this.openByWorkstream = { ...this.openByWorkstream, [workstreamId]: open };
	}
}

export const openRunsStore = new OpenRunsStore();
