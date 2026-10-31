import type { UsageReport } from '$contract/system';

class UsageDataStore {
	shared = $state<boolean | null>(null);
	report = $state<UsageReport | null>(null);

	set(shared: boolean | null): void {
		this.shared = shared;
	}

	setReport(report: UsageReport | null): void {
		this.report = report;
	}
}

export const usageDataStore = new UsageDataStore();
