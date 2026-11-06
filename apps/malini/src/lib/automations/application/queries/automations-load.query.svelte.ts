import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';

export { automationsLoadQuery };

class AutomationsLoadQuery {
	public readonly data: Readonly<{
		state: 'idle' | 'loading' | 'ready' | 'error';
		error: string | null;
	}> = $derived({
		state: automationDefinitionsAggregate.loadState,
		error: automationDefinitionsAggregate.loadError,
	});
}

const automationsLoadQuery = new AutomationsLoadQuery();
