import { RECENT_DIAGNOSTICS_LIMIT } from '$lib/app/domain/recent-diagnostics';
import { recentDiagnosticsAggregate } from '$lib/app/infrastructure/aggregates/recent-diagnostics.aggregate.svelte';
import { diagnosticsService } from '$lib/app/infrastructure/services/diagnostics.service';

export function loadRecentDiagnosticsCommand(): void {
	void (async () => {
		try {
			recentDiagnosticsAggregate.replace(await diagnosticsService.recent(RECENT_DIAGNOSTICS_LIMIT));
		} catch (error) {
			recentDiagnosticsAggregate.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
