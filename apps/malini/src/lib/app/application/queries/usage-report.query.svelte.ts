import type { UsageReport } from '$contract/system';
import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

class UsageReportQuery {
	public readonly data: UsageReport | null = $derived(usageDataStore.report);
}

export const usageReportQuery = new UsageReportQuery();
