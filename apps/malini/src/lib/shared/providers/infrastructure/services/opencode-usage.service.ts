import type { AgentPlanUsage } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class OpencodeUsageService {
	load(): Promise<AgentPlanUsage | null> {
		return invoke('providers.load-opencode-usage', undefined);
	}
}

export const opencodeUsageService = new OpencodeUsageService();
