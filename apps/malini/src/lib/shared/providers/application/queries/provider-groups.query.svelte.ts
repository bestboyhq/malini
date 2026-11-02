import { providerGroups, type ProviderGroup } from '$shared/providers/domain/provider';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { providerGroupsQuery };

class ProviderGroupsQuery {
	public readonly data: readonly ProviderGroup[] = $derived(
		providerGroups(providerCapabilitiesStore.capability, modelProvidersStore.providers),
	);
}

const providerGroupsQuery = new ProviderGroupsQuery();
