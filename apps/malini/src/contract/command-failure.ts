import type { CommandFailure } from './ipc';

export class CommandError extends Error {
	readonly code: string | null;
	readonly kind: string | null;
	readonly command: string;

	constructor(failure: CommandFailure) {
		super(failure.message);
		this.name = failure.name;
		this.code = failure.code;
		this.kind = failure.kind;
		this.command = failure.command;
	}
}

export function commandRejection(command: string, rejection: unknown): Error {
	if (rejection instanceof Error) return rejection;
	return new CommandError(commandFailureOf(command, rejection));
}

function commandFailureOf(command: string, rejection: unknown): CommandFailure {
	const unexplained = `${command} failed and gave no reason`;
	if (typeof rejection === 'string') {
		return failure(command, 'Error', rejection.trim() ? rejection : unexplained);
	}
	if (typeof rejection !== 'object' || rejection === null) {
		return failure(command, 'Error', unexplained);
	}
	return {
		name: text(Reflect.get(rejection, 'name')) ?? 'Error',
		message: text(Reflect.get(rejection, 'message')) ?? unexplained,
		code: text(Reflect.get(rejection, 'code')),
		kind: text(Reflect.get(rejection, 'kind')),
		command: text(Reflect.get(rejection, 'command')) ?? command,
	};
}

function failure(command: string, name: string, message: string): CommandFailure {
	return { name, message, code: null, kind: null, command };
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
