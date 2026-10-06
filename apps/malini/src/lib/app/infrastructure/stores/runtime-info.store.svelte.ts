import type { RuntimeInfo } from '$contract/runtime';

class RuntimeInfoStore {
	current = $state.raw<RuntimeInfo | null>(null);

	set(info: RuntimeInfo | null): void {
		this.current = info;
	}
}

export const runtimeInfoStore = new RuntimeInfoStore();
