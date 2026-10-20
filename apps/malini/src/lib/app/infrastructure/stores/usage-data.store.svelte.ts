class UsageDataStore {
	shared = $state<boolean | null>(null);

	set(shared: boolean | null): void {
		this.shared = shared;
	}
}

export const usageDataStore = new UsageDataStore();
