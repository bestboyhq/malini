import type { RecentDiagnostics } from '$lib/app/domain/recent-diagnostics';
import { recentDiagnosticsAggregate } from '$lib/app/infrastructure/aggregates/recent-diagnostics.aggregate.svelte';

class RecentDiagnosticsQuery {
	public readonly data: RecentDiagnostics = $derived({
		entries: recentDiagnosticsAggregate.entries,
		failure: recentDiagnosticsAggregate.failure,
	});
}

export const recentDiagnosticsQuery = new RecentDiagnosticsQuery();
