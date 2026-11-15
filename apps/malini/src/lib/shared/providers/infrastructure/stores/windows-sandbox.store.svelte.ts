import type { WindowsSandboxSetup } from '$shared/providers/domain/windows-sandbox';

class WindowsSandboxStore {
	state: WindowsSandboxSetup = $state.raw({ kind: 'idle' });
}

export const windowsSandboxStore = new WindowsSandboxStore();
