import { beforeEach, describe, expect, it } from 'vitest';
import { inspectorPanelCommands } from './panel-requests.store.svelte';

describe('inspectorPanelCommands', () => {
	beforeEach(() => inspectorPanelCommands.reset());

	it('routes an open request only to its workstream, and only once', () => {
		inspectorPanelCommands.open('workstream-a', 'example.terminal.panel');
		const [request] = inspectorPanelCommands.requestsFor('workstream-a');
		expect(request?.panelId).toBe('example.terminal.panel');
		expect(inspectorPanelCommands.requestsFor('workstream-b')).toEqual([]);
		inspectorPanelCommands.consume('workstream-a', (request?.revision ?? 0) - 1);
		expect(inspectorPanelCommands.requestsFor('workstream-a')).toHaveLength(1);
		inspectorPanelCommands.consume('workstream-a', request?.revision ?? 0);
		expect(inspectorPanelCommands.requestsFor('workstream-a')).toEqual([]);
	});

	it('still reveals a panel while an open waits for a panel that never comes', () => {
		inspectorPanelCommands.open('workstream-a', 'gone.panel');
		inspectorPanelCommands.reveal('workstream-a', 'browser-tab:1');

		expect(
			inspectorPanelCommands
				.requestsFor('workstream-a')
				.map(({ panelId, reveal }) => ({ panelId, reveal })),
		).toEqual([
			{ panelId: 'browser-tab:1', reveal: true },
			{ panelId: 'gone.panel', reveal: false },
		]);
	});
});
