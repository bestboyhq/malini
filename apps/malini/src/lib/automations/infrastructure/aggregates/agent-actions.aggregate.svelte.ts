import type { AgentActionRecord } from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

class AgentActionsAggregate {
	actions = $state.raw<readonly AgentActionRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const actions = await automationsService.listAgentActions();
		if (generation !== this.#generation) return;
		const loaded = new Set(actions.map((action) => action.id));
		this.actions = [...actions, ...this.actions.filter((action) => !loaded.has(action.id))];
	}

	apply(action: AgentActionRecord): void {
		this.actions = [action, ...this.actions.filter((existing) => existing.id !== action.id)];
	}
}

export const agentActionsAggregate = new AgentActionsAggregate();
