import type { AgentPlanUsage } from '$contract/agent';
import { opencodeUsageService } from '$shared/providers/infrastructure/services/opencode-usage.service';

export { opencodeUsageQuery };

class OpencodeUsageQuery {
	public data: AgentPlanUsage | null = $state(null);

	async load(): Promise<void> {
		this.data = (await opencodeUsageService.load().catch(() => null)) ?? null;
	}
}

const opencodeUsageQuery = new OpencodeUsageQuery();
