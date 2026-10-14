export type InspectorPanelOpenRequest = Readonly<{
	workstreamId: string;
	panelId: string;
	revision: number;
	reveal: boolean;
}>;

class InspectorPanelCommands {
	requests = $state<Record<string, InspectorPanelOpenRequest>>({});
	#revision = 0;

	open(workstreamId: string, panelId: string): void {
		this.#request(workstreamId, panelId, false);
	}

	reveal(workstreamId: string, panelId: string): void {
		if (this.requests[workstreamId]?.reveal === false) return;
		this.#request(workstreamId, panelId, true);
	}

	#request(workstreamId: string, panelId: string, reveal: boolean): void {
		if (!workstreamId || !panelId) return;
		this.requests = {
			...this.requests,
			[workstreamId]: { workstreamId, panelId, revision: ++this.#revision, reveal },
		};
	}

	requestFor(workstreamId: string): InspectorPanelOpenRequest | null {
		return this.requests[workstreamId] ?? null;
	}

	consume(workstreamId: string, revision: number): void {
		if (this.requests[workstreamId]?.revision !== revision) return;
		const { [workstreamId]: _consumed, ...remaining } = this.requests;
		this.requests = remaining;
	}

	reset(): void {
		this.requests = {};
	}
}

export const inspectorPanelCommands = new InspectorPanelCommands();
