class PublishFlowStore {
	turningOn: boolean = $state(false);
	handle: string | null = $state(null);
	problem: string | null = $state(null);
	sending: boolean = $state(false);

	start(): void {
		this.turningOn = true;
		this.handle = null;
		this.problem = null;
		this.sending = false;
	}

	edit(handle: string): void {
		this.handle = handle;
		this.problem = null;
	}

	send(): void {
		this.sending = true;
		this.problem = null;
	}

	fail(problem: string): void {
		this.sending = false;
		this.problem = problem;
	}

	finish(): void {
		this.turningOn = false;
		this.handle = null;
		this.problem = null;
		this.sending = false;
	}
}

export const publishFlowStore = new PublishFlowStore();
