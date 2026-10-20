import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type { ContractEvents, EventChannel } from '$contract/events';

export type PlatformBridge = Readonly<{
	invoke<Name extends CommandName>(
		command: Name,
		args: CommandArgs<Name>,
	): Promise<CommandResult<Name>>;
	on<Channel extends EventChannel>(
		channel: Channel,
		listener: (payload: ContractEvents[Channel]) => void,
	): () => void;
}>;
