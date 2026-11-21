import type { WindowControlsState } from '$contract/events';

class WindowControlsStore {
	#state: WindowControlsState = $state({ focused: true, maximized: false });

	get state(): WindowControlsState {
		return this.#state;
	}

	observe(state: WindowControlsState): void {
		this.#state = state;
	}
}

export const windowControlsStore = new WindowControlsStore();
