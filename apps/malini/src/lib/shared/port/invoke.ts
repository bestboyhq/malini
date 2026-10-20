import { commandRejection } from '$contract/command-failure';
import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import { platformBridge } from './platform';

export async function invoke<Name extends CommandName>(
	command: Name,
	args: CommandArgs<Name>,
): Promise<CommandResult<Name>> {
	try {
		return await platformBridge().invoke(command, args);
	} catch (rejection) {
		throw commandRejection(command, rejection);
	}
}
