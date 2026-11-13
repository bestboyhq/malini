import { problemReportService } from '$lib/app/infrastructure/services/problem-report.service';
import { problemReportStore } from '$lib/app/infrastructure/stores/problem-report.store.svelte';

export function fileProblemCommand(text: string, facts: readonly string[]): void {
	if (problemReportStore.filing) return;
	problemReportStore.beginFiling();
	void (async () => {
		try {
			problemReportStore.setFiled(await problemReportService.file(text, facts));
		} catch (error) {
			problemReportStore.fail(error instanceof Error ? error.message : String(error));
			console.error('[malini app] gh could not file the problem report', error);
		}
	})();
}
