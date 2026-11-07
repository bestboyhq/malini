import { agentActionsAggregate } from '$lib/automations/infrastructure/aggregates/agent-actions.aggregate.svelte';
import { chatTurnsAggregate } from '$lib/automations/infrastructure/aggregates/chat-turns.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { loadActivityCommand, showEveryChatTurnCommand };

function loadActivityCommand(): void {
	void Promise.all([
		agentActionsAggregate.load(),
		chatTurnsAggregate.load(),
		reconcilerDecisionsAggregate.load(),
	]).catch((error: unknown) => {
		console.error('[malini automations] could not load activity', error);
	});
}

function showEveryChatTurnCommand(every: boolean): void {
	chatTurnsAggregate.every = every;
	void chatTurnsAggregate.load().catch((error: unknown) => {
		console.error('[malini automations] could not load chat turns', error);
	});
}
