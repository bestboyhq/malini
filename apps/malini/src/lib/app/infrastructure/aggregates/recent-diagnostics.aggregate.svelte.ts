import type { DiagnosticEntry } from '$contract/diagnostics';

class RecentDiagnosticsAggregate {
	entries = $state.raw<readonly DiagnosticEntry[] | null>(null);
	failure = $state.raw<string | null>(null);

	replace(entries: readonly DiagnosticEntry[]): void {
		this.entries = entries;
		this.failure = null;
	}

	fail(message: string): void {
		this.failure = message;
	}
}

export const recentDiagnosticsAggregate = new RecentDiagnosticsAggregate();
