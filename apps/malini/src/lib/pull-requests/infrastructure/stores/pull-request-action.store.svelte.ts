class PullRequestActionStore {
	busy = $state(false);
	busyLabel = $state<string | null>(null);
	#revision = 0;

	get revision(): number {
		return this.#revision;
	}

	claim(busyLabel: string | null = null): number {
		this.#revision += 1;
		this.busy = true;
		this.busyLabel = busyLabel;
		return this.#revision;
	}

	release(revision: number): void {
		if (this.#revision !== revision) return;
		this.busy = false;
		this.busyLabel = null;
	}

	reset(): void {
		this.#revision += 1;
		this.busy = false;
		this.busyLabel = null;
	}
}

export const pullRequestActionStore = new PullRequestActionStore();
