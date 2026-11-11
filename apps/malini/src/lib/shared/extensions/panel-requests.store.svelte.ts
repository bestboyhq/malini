export type InspectorPanelOpenRequest = Readonly<{
	workstreamId: string;
	panelId: string;
	revision: number;
	reveal: boolean;
}>;

type PendingPanelRequests = Readonly<{
	open?: InspectorPanelOpenRequest;
	reveal?: InspectorPanelOpenRequest;
}>;

class InspectorPanelCommands {
	requests = $state<Record<string, PendingPanelRequests>>({});
	#revision = 0;

	open(workstreamId: string, panelId: string): void {
		this.#request(workstreamId, panelId, false);
	}

	reveal(workstreamId: string, panelId: string): void {
		this.#request(workstreamId, panelId, true);
	}

	#request(workstreamId: string, panelId: string, reveal: boolean): void {
		if (!workstreamId || !panelId) return;
		const request = { workstreamId, panelId, revision: ++this.#revision, reveal };
		this.requests = {
			...this.requests,
			[workstreamId]: { ...this.requests[workstreamId], [reveal ? 'reveal' : 'open']: request },
		};
	}

	requestsFor(workstreamId: string): InspectorPanelOpenRequest[] {
		const { reveal, open } = this.requests[workstreamId] ?? {};
		return [reveal, open].filter((request) => request !== undefined);
	}

	consume(workstreamId: string, revision: number): void {
		const { [workstreamId]: pending, ...others } = this.requests;
		if (!pending) return;
		const open = pending.open?.revision === revision ? undefined : pending.open;
		const reveal = pending.reveal?.revision === revision ? undefined : pending.reveal;
		if (open === pending.open && reveal === pending.reveal) return;
		this.requests =
			open || reveal
				? { ...others, [workstreamId]: { ...(open && { open }), ...(reveal && { reveal }) } }
				: others;
	}

	reset(): void {
		this.requests = {};
	}
}

export const inspectorPanelCommands = new InspectorPanelCommands();
