import { problemReportStore } from '$lib/app/infrastructure/stores/problem-report.store.svelte';

export function closeProblemReportCommand(): void {
	problemReportStore.dismiss();
}
