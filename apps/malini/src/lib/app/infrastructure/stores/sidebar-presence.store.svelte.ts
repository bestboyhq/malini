class SidebarPresenceStore {
	#count = $state(0);

	get current(): boolean {
		return this.#count > 0;
	}

	enter(): () => void {
		this.#count += 1;
		let left = false;
		return () => {
			if (left) return;
			left = true;
			this.#count -= 1;
		};
	}
}

export const sidebarPresenceStore = new SidebarPresenceStore();
