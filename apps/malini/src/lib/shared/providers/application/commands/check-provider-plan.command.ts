import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { checkProviderPlanCommand };

async function checkProviderPlanCommand(providerId: string): Promise<void> {
	await modelProvidersService.checkPlan(providerId);
	await modelProvidersStore.refresh();
}
