class ProvisioningRetryStore {
	retrying: Readonly<Record<string, true>> = $state({});

	isRetrying(workstreamId: string): boolean {
		return this.retrying[workstreamId] === true;
	}

	begin(workstreamId: string): void {
		this.retrying = { ...this.retrying, [workstreamId]: true };
	}

	finish(workstreamId: string): void {
		if (!this.isRetrying(workstreamId)) return;
		const next = { ...this.retrying };
		delete next[workstreamId];
		this.retrying = next;
	}

	reset(): void {
		this.retrying = {};
	}
}

export const provisioningRetryStore = new ProvisioningRetryStore();
