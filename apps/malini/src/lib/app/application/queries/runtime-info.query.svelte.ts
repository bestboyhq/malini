import type { RuntimeInfo } from '$contract/runtime';
import { runtimeInfoStore } from '$lib/app/infrastructure/stores/runtime-info.store.svelte';

class RuntimeInfoQuery {
	public readonly data: RuntimeInfo | null = $derived(runtimeInfoStore.current);
}

export const runtimeInfoQuery = new RuntimeInfoQuery();
