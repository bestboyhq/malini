import type { ExtensionAction } from '$lib/extensions/domain/extension-action';

class ExtensionActionsStore {
	actions = $state.raw<ReadonlyMap<string, ExtensionAction>>(new Map());

	set(key: string, action: ExtensionAction): void {
		this.actions = new Map(this.actions).set(key, action);
	}

	clear(key: string): void {
		if (!this.actions.has(key)) return;
		const next = new Map(this.actions);
		next.delete(key);
		this.actions = next;
	}
}

export const extensionActionsStore = new ExtensionActionsStore();
