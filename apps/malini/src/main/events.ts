import { BrowserWindow } from 'electron';
import {
	CHAT_AGENT_EVENT_CHANNEL,
	type ContractEvents,
	type EventChannel,
} from '../contract/events';
import { EVENT_CHANNEL, type EventFrame } from '../contract/ipc';

const EPHEMERAL_FRAME_WINDOW_MS = 16;

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

function isEphemeralFrame(frame: EventFrame): boolean {
	const payload = frame.payload;
	return (
		frame.channel === CHAT_AGENT_EVENT_CHANNEL &&
		typeof payload === 'object' &&
		payload !== null &&
		'ephemeral' in payload &&
		payload.ephemeral === true
	);
}

function sendToWindows(frames: EventFrame | readonly EventFrame[]): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
		if (window.webContents.isCrashed()) continue;
		window.webContents.send(EVENT_CHANNEL, frames);
	}
}

function createWindowForwarder(): (frame: EventFrame) => void {
	let pending: EventFrame[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		if (pending.length === 0) return;
		const frames = pending;
		pending = [];
		sendToWindows(frames);
	};
	return (frame) => {
		if (!isEphemeralFrame(frame)) {
			flush();
			sendToWindows(frame);
			return;
		}
		pending.push(frame);
		timer ??= setTimeout(flush, EPHEMERAL_FRAME_WINDOW_MS);
	};
}

export function createEventBus(options: { forwardToWindows?: boolean } = {}): EventBus {
	const forward = options.forwardToWindows === false ? null : createWindowForwarder();
	const listeners = new Map<EventChannel, Set<EventListener>>();
	return {
		emit(channel, payload) {
			forward?.({ channel, payload });
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
