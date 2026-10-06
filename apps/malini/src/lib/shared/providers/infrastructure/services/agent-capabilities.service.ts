import type { ProviderCapability } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class AgentCapabilitiesService {
	list(refresh: boolean): Promise<ProviderCapability[]> {
		return invoke('chat.agent-capabilities', refresh ? { refresh: true } : {});
	}
}

export const agentCapabilitiesService = new AgentCapabilitiesService();
