import { invoke } from '$shared/port/invoke';

class PlanUsageService {
	claudeReadings(): Promise<Record<string, unknown>[]> {
		return invoke('chat.list-claude-plan-usage', undefined);
	}
}

export const planUsageService = new PlanUsageService();
