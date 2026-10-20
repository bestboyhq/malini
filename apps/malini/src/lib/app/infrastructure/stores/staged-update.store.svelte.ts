class StagedUpdateStore {
	#version: string | null = $state(null);
	#restarting: boolean = $state(false);

	get version(): string | null {
		return this.#version;
	}

	get restarting(): boolean {
		return this.#restarting;
	}

	stage(version: string | null): void {
		this.#version = version;
	}

	setRestarting(restarting: boolean): void {
		this.#restarting = restarting;
	}
}

export const stagedUpdateStore = new StagedUpdateStore();
