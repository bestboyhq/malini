class SteRepliesStore {
	on = $state<boolean | null>(null);

	set(on: boolean | null): void {
		this.on = on;
	}
}

export const steRepliesStore = new SteRepliesStore();
