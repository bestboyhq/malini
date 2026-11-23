import type { WindowsSandboxSetup } from '$shared/providers/domain/windows-sandbox';
import { windowsSandboxStore } from '$shared/providers/infrastructure/stores/windows-sandbox.store.svelte';

export { windowsSandboxQuery };

class WindowsSandboxQuery {
	public readonly data: WindowsSandboxSetup = $derived(windowsSandboxStore.state);
}

const windowsSandboxQuery = new WindowsSandboxQuery();
