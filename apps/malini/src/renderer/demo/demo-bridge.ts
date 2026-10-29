import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type { ContractEvents, EventChannel } from '$contract/events';

type MaliniApi = Window['malini'];

export type DemoHandlers = {
	[Name in CommandName]?: (
		args: CommandArgs<Name>,
	) => CommandResult<Name> | Promise<CommandResult<Name>>;
};

export type DemoEmit = <Channel extends EventChannel>(
	channel: Channel,
	payload: ContractEvents[Channel],
) => void;

export const DEMO_REFUSAL = 'The demo shows Malini on made-up data. Download Malini to do this.';

export function demoBridge(handlersFor: (emit: DemoEmit) => DemoHandlers): MaliniApi {
	const events = new EventTarget();
	const emit: DemoEmit = (channel, payload) => {
		events.dispatchEvent(new CustomEvent(channel, { detail: payload }));
	};
	const handlers = handlersFor(emit);
	return {
		windowChrome: { zoomFactor: () => 1 },
		async invoke<Name extends CommandName>(
			command: Name,
			args: CommandArgs<Name>,
		): Promise<CommandResult<Name>> {
			const handler: DemoHandlers[Name] = handlers[command];
			if (!handler) throw new Error(DEMO_REFUSAL);
			return handler(args);
		},
		on<Channel extends EventChannel>(
			channel: Channel,
			listener: (payload: ContractEvents[Channel]) => void,
		): () => void {
			const deliver = (event: Event): void => {
				if (event instanceof CustomEvent) listener(event.detail);
			};
			events.addEventListener(channel, deliver);
			return () => events.removeEventListener(channel, deliver);
		},
	};
}
