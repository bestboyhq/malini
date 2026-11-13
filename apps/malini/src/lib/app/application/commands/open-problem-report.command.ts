import { problemReportService } from '$lib/app/infrastructure/services/problem-report.service';
import { problemReportStore } from '$lib/app/infrastructure/stores/problem-report.store.svelte';

export function openProblemReportCommand(): void {
	problemReportStore.begin();
	void (async () => {
		try {
			problemReportStore.setReport(await problemReportService.read());
		} catch (error) {
			problemReportStore.failRead();
			console.error('[malini app] could not read the facts for a problem report', error);
		}
	})();
}
