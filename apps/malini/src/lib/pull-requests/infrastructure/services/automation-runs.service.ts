import { invoke } from '$shared/port/invoke';

class AutomationRunsService {
	async sessionFor(automationRunId: string): Promise<string | null> {
		const runs = await invoke('automations.list-runs', undefined);
		return runs.find((run) => run.id === automationRunId)?.sessionId ?? null;
	}
}

export const automationRunsService = new AutomationRunsService();
