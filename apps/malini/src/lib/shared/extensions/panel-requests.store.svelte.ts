export type InspectorPanelOpenRequest = Readonly<{
	workstreamId: string;
	panelId: string;
	revision: number;
}>;

class InspectorPanelCommands {
	requests = $state<Record<string, InspectorPanelOpenRequest>>({});
	#revision = 0;

	open(workstreamId: string, panelId: string): void {
		if (!workstreamId || !panelId) return;
		this.requests = {
			...this.requests,
			[workstreamId]: { workstreamId, panelId, revision: ++this.#revision },
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
