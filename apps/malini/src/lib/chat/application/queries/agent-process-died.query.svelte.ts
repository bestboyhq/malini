import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';

export { agentProcessDiedQuery };

class AgentProcessDiedQuery {
	public readonly data: boolean = $derived.by(() => {
		const owner = sessionActivation.activeRunOwner();
		return owner ? agentRunner.bridgeDeadFor(owner) : false;
	});
}

const agentProcessDiedQuery = new AgentProcessDiedQuery();
