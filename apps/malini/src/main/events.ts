import { BrowserWindow } from 'electron';
import type { ContractEvents, EventChannel } from '../contract/events';
import { EVENT_CHANNEL, type EventFrame } from '../contract/ipc';

export type EventListener<Channel extends EventChannel = EventChannel> = {
	bivarianceHack(payload: ContractEvents[Channel]): void;
}['bivarianceHack'];

export interface EventBus {
	emit<Channel extends EventChannel>(channel: Channel, payload: ContractEvents[Channel]): void;
	subscribe<Channel extends EventChannel>(
		channel: Channel,
		listener: EventListener<Channel>,
	): () => void;
}

export function createEventBus(options: { forwardToWindows?: boolean } = {}): EventBus {
	const forward = options.forwardToWindows ?? true;
	const listeners = new Map<EventChannel, Set<EventListener>>();
	return {
		emit(channel, payload) {
			const frame: EventFrame = { channel, payload };
			if (forward) {
				for (const window of BrowserWindow.getAllWindows()) {
					if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
					if (window.webContents.isCrashed()) continue;
					window.webContents.send(EVENT_CHANNEL, frame);
				}
			}
			const set = listeners.get(channel);
			if (!set) return;
			for (const listener of [...set]) listener(payload);
		},
		subscribe(channel, listener) {
			let set = listeners.get(channel);
			if (!set) {
				set = new Set();
				listeners.set(channel, set);
			}
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
	};
}
