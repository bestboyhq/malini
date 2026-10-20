import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';

const WORKSTREAM_BOOTSTRAP_PHASE_BUDGET_MS = 300;

class ChatBootstrapTelemetryService {
	measurePhase<T>(workstreamId: string, label: string, operation: () => Promise<T>): Promise<T> {
		return runtimeDiagnostics.measure(
			{
				category: 'runtime',
				label,
				budgetMs: WORKSTREAM_BOOTSTRAP_PHASE_BUDGET_MS,
				target: workstreamId,
			},
			operation,
		);
	}

	measureSessionListFetch<T>(workstreamId: string, operation: () => Promise<T>): Promise<T> {
		return this.measurePhase(workstreamId, 'Listing workstream chats', operation);
	}
}

export const chatBootstrapTelemetry = new ChatBootstrapTelemetryService();
