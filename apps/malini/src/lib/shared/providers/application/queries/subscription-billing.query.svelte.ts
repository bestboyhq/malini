import { claudeCodeStatus, usesSubscription } from '$shared/providers/domain/claude-code-status';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { subscriptionBillingQuery };

class SubscriptionBillingQuery {
	public readonly data: boolean = $derived(
		usesSubscription(claudeCodeStatus(providerCapabilitiesStore.capability, null)),
	);
}

const subscriptionBillingQuery = new SubscriptionBillingQuery();
