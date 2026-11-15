class CompactOutputStore {
	on = $state<boolean | null>(null);

	set(on: boolean | null): void {
		this.on = on;
	}
}

export const compactOutputStore = new CompactOutputStore();
