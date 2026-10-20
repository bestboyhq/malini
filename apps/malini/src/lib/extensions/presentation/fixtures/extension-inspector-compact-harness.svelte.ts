import type { ExtensionPanelRegistration } from '@malini/extension-api';

import type { GutterChangeTotals } from '$shared/extensions/inspector-gutter-row';
import { InspectorPanelRegistry } from '../../infrastructure/stores/inspector-panel-registry.store.svelte';
import type { InspectorPreferenceStorage } from '$shared/extensions/inspector-preference-storage';

export class CompactHarnessProps {
	workstreamId = $state('ws-1');
	workstreamName = $state<string | null>(null);
	panels = $state.raw<readonly ExtensionPanelRegistration[]>([]);
	changeTotals = $state.raw<GutterChangeTotals | null>(null);
	storage: InspectorPreferenceStorage | null | undefined = undefined;

	constructor(init: Partial<CompactHarnessProps> = {}) {
		Object.assign(this, init);
	}
}

export class RegistryHarnessProps extends CompactHarnessProps {
	readonly registry = new InspectorPanelRegistry();

	constructor(init: Partial<CompactHarnessProps> = {}) {
		super(init);
	}

	get registeredPanels(): readonly ExtensionPanelRegistration[] {
		return this.registry.panels;
	}

	register(panel: ExtensionPanelRegistration): void {
		this.registry.register(panel);
	}
}

export function panelRegistration(id: string, label: string): ExtensionPanelRegistration {
	return {
		id,
		label,
		icon: `${id}-icon`,
		component: { mount: async () => ({ dispose: () => undefined }) },
	};
}
