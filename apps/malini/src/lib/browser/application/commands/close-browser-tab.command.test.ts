import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserTabKey } from '../../domain/browser-tab';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';
import { closeBrowserTabCommand } from './close-browser-tab.command';

const TAB = { workstreamId: 'ws-1', tabId: 'tab-closed' };
const KEY = browserTabKey(TAB);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('closeBrowserTabCommand', () => {
	it('forgets where the tab was placed and that its address wanted the cursor', async () => {
		const invoked: string[] = [];
		vi.stubGlobal('window', {
			malini: {
				invoke: async (command: string) => {
					invoked.push(command);
					return null;
				},
			},
		});
		const turn = browserViewStore.place(KEY, {
			kind: 'shown',
			bounds: { x: 0, y: 0, width: 400, height: 300 },
		});
		browserViewStore.setAddressFocus(KEY, true);
		browserViewStore.setSnapshot(KEY, 'data:image/jpeg;base64,AA==');

		closeBrowserTabCommand(TAB);

		await vi.waitFor(() => expect(browserViewStore.snapshots[KEY]).toBeUndefined());
		expect(invoked).toEqual(['browser.close']);
		expect(browserViewStore.addressFocus.has(KEY)).toBe(false);
		expect(turn !== null && browserViewStore.isLatest(KEY, turn)).toBe(false);
	});
});
