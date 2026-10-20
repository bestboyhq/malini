import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { InspectorPanelRegistry } from './inspector-panel-registry.store.svelte';

function panel(id: string): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: `${id}-icon`,
		component: { mount: () => ({ dispose: () => undefined }) },
	};
}

describe('InspectorPanelRegistry', () => {
	it('projects extension lifecycle registrations and removes them idempotently', async () => {
		const registry = new InspectorPanelRegistry();
		const first = panel('community.first');
		const second = panel('community.second');
		const firstRegistration = registry.register(first);
		const secondRegistration = registry.register(second);

		expect(registry.panels).toEqual([first, second]);
		await firstRegistration.dispose();
		await firstRegistration.dispose();
		expect(registry.panels).toEqual([second]);
		await secondRegistration.dispose();
		expect(registry.panels).toEqual([]);
	});

	it('rejects duplicate contribution ids', () => {
		const registry = new InspectorPanelRegistry();
		registry.register(panel('community.panel'));
		expect(() => registry.register(panel('community.panel'))).toThrow(
			'Inspector panel community.panel is already registered',
		);
	});

	it('does not let a stale disposer remove a same-id replacement after clear', async () => {
		const registry = new InspectorPanelRegistry();
		const first = panel('community.panel');
		const replacement = panel('community.panel');
		const staleRegistration = registry.register(first);

		registry.clear();
		const replacementRegistration = registry.register(replacement);
		await staleRegistration.dispose();

		expect(registry.panels).toEqual([replacement]);
		await replacementRegistration.dispose();
		expect(registry.panels).toEqual([]);
	});

	it('does not let an already-disposed registration remove its same-id successor', async () => {
		const registry = new InspectorPanelRegistry();
		const staleRegistration = registry.register(panel('community.panel'));
		await staleRegistration.dispose();
		const replacement = panel('community.panel');
		const replacementRegistration = registry.register(replacement);

		await staleRegistration.dispose();

		expect(registry.panels).toEqual([replacement]);
		await replacementRegistration.dispose();
	});
});
