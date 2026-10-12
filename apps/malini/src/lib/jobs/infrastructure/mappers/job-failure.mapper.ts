import { CommandError } from '$contract/command-failure';

const INVALID_ARGS_PREFIX = /^invalid args:\s*/u;

export class JobFailureMapper {
	static fromRaw(raw: unknown): Error {
		const message = raw instanceof Error ? raw.message : String(raw);
		const kind = raw instanceof CommandError ? raw.kind : null;
		if (kind === 'not-found') {
			return new Error('It no longer exists. Reload the Jobs page to see what is left.');
		}
		if (kind === 'invalid-args') {
			return new Error(`malini could not use that: ${message.replace(INVALID_ARGS_PREFIX, '')}`);
		}
		return new Error(message);
	}
}
