import { runtimeInfoService } from '$lib/app/infrastructure/services/runtime-info.service';
import { runtimeInfoStore } from '$lib/app/infrastructure/stores/runtime-info.store.svelte';

export function loadRuntimeInfoCommand(): void {
	void (async () => {
		try {
			runtimeInfoStore.set(await runtimeInfoService.read());
		} catch (error) {
			runtimeInfoStore.set(null);
			console.error('[malini app] could not read the runtime info', error);
		}
	})();
}
