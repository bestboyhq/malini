import type { PublishFlow } from '$lib/stats/domain/publish-flow';
import { publishFlowStore } from '$lib/stats/infrastructure/stores/publish-flow.store.svelte';

export { publishFlowQuery };

class PublishFlowQuery {
	public readonly data: PublishFlow = $derived({
		turningOn: publishFlowStore.turningOn,
		handle: publishFlowStore.handle,
		problem: publishFlowStore.problem,
		sending: publishFlowStore.sending,
	});
}

const publishFlowQuery = new PublishFlowQuery();
