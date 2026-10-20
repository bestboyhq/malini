import { beforeEach, describe, expect, it } from 'vitest';
import { inspectorPanelCommands } from './panel-requests.store.svelte';

describe('inspectorPanelCommands', () => {
	beforeEach(() => inspectorPanelCommands.reset());

	it('routes an open request only to its workstream, and only once', () => {
		inspectorPanelCommands.open('workstream-a', 'example.terminal.panel');
		const request = inspectorPanelCommands.requestFor('workstream-a');
		expect(request?.panelId).toBe('example.terminal.panel');
		expect(inspectorPanelCommands.requestFor('workstream-b')).toBeNull();
		inspectorPanelCommands.consume('workstream-a', (request?.revision ?? 0) - 1);
		expect(inspectorPanelCommands.requestFor('workstream-a')).not.toBeNull();
		inspectorPanelCommands.consume('workstream-a', request?.revision ?? 0);
		expect(inspectorPanelCommands.requestFor('workstream-a')).toBeNull();
	});
});
