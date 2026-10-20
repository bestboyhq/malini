import type { DiagnosticEntry } from '$contract/diagnostics';
import { invoke } from '$shared/port/invoke';

class DiagnosticsService {
	recent(limit: number): Promise<DiagnosticEntry[]> {
		return invoke('app.recent-diagnostics', { limit });
	}
}

export const diagnosticsService = new DiagnosticsService();
