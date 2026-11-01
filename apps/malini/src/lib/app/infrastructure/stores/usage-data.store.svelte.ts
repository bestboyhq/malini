import type { UsageDataState, UsageReport } from '$contract/system';

class UsageDataStore {
	shared = $state<boolean | null>(null);
	doNotTrack = $state(false);
	report = $state<UsageReport | null>(null);

	set(shared: boolean | null): void {
		this.shared = shared;
	}

	setState(state: UsageDataState): void {
		this.doNotTrack = state.doNotTrack;
		this.report = state.report;
	}
}

export const usageDataStore = new UsageDataStore();
