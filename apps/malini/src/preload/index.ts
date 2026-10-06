import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import type { CommandArgs, CommandName, CommandResult } from '../contract/commands';
import type { ContractEvents, EventChannel } from '../contract/events';
import {
	EVENT_CHANNEL,
	INVOKE_CHANNEL,
	type CommandFailure,
	type EventFrame,
	type InvokeReply,
	type InvokeRequest,
} from '../contract/ipc';

type AnyEventCallback = { bivarianceHack(payload: unknown): void }['bivarianceHack'];

async function invokeCommand<Name extends CommandName>(
	command: Name,
	args: CommandArgs<Name>,
): Promise<CommandResult<Name>>;
async function invokeCommand(command: string, args: unknown): Promise<unknown> {
	const request: InvokeRequest = { command, args: args ?? {} };
	let reply: InvokeReply;
	try {
		reply = await ipcRenderer.invoke(INVOKE_CHANNEL, request);
	} catch (error) {
		throw transportFailure(command, error);
	}
	if (reply.ok) return reply.value;
	throw reply.failure;
}

function transportFailure(command: string, error: unknown): CommandFailure {
	return {
		name: error instanceof Error ? error.name : 'Error',
		message: error instanceof Error ? error.message : String(error),
		code: null,
		kind: null,
		command,
	};
}

const subscribers = new Map<string, Set<AnyEventCallback>>();

ipcRenderer.on(EVENT_CHANNEL, (_event: IpcRendererEvent, frame: EventFrame) => {
	const set = subscribers.get(frame.channel);
	if (!set) return;
	for (const callback of [...set]) callback(frame.payload);
});

function subscribe<Channel extends EventChannel>(
	channel: Channel,
	callback: (payload: ContractEvents[Channel]) => void,
): () => void;
function subscribe(channel: string, callback: AnyEventCallback): () => void {
	let set = subscribers.get(channel);
	if (!set) {
		set = new Set();
		subscribers.set(channel, set);
	}
	set.add(callback);
	return () => {
		set.delete(callback);
		if (set.size === 0) subscribers.delete(channel);
	};
}

const api = {
	windowChrome: {
		zoomFactor: (): number => webFrame.getZoomFactor(),
	},

	invoke: invokeCommand,

	on: subscribe,
};

export type MaliniApi = typeof api;

contextBridge.exposeInMainWorld('malini', api);
