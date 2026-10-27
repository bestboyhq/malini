import type { UpdateStatus } from '$contract/events';

class UpdateStatusStore {
	#status: UpdateStatus = $state({ state: 'idle' });
	#restarting: boolean = $state(false);

	get status(): UpdateStatus {
		return this.#status;
	}

	get restarting(): boolean {
		return this.#restarting;
	}

	observe(status: UpdateStatus): void {
		this.#status = status;
	}

	setRestarting(restarting: boolean): void {
		this.#restarting = restarting;
	}
}

export const updateStatusStore = new UpdateStatusStore();
