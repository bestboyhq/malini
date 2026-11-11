import { describe, expect, it, vi } from 'vitest';
import type { EventFrame } from '../contract/ipc';
import type { MaliniApi } from './index';

const bridge = vi.hoisted(() => {
	const state: {
		api: MaliniApi | null;
		deliver: ((event: unknown, frames: EventFrame) => void) | null;
	} = { api: null, deliver: null };
	return state;
});

vi.mock('electron', () => ({
	contextBridge: {
		exposeInMainWorld: (_name: string, api: MaliniApi) => {
			bridge.api = api;
		},
	},
	ipcRenderer: {
		on: (_channel: string, listener: (event: unknown, frames: EventFrame) => void) => {
			bridge.deliver = listener;
		},
	},
	webFrame: {},
}));

await import('./index');

describe('the preload event bridge', () => {
	it('keeps a later listener when an earlier unsubscribe runs twice', () => {
		const api = bridge.api;
		if (api === null) throw new Error('the preload exposed no api');
		const heard: string[] = [];
		const stopFirst = api.on('app:close-requested', () => heard.push('first'));
		stopFirst();
		api.on('app:close-requested', () => heard.push('second'));
		stopFirst();

		bridge.deliver?.({}, { channel: 'app:close-requested', payload: {} });

		expect(heard).toEqual(['second']);
	});
});
