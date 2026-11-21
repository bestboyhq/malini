import {
	REPOSITORY_FULL_NAME_MAX_LENGTH,
	SCRATCHPAD_CONTENT_MAX_LENGTH,
} from '$contract/scratchpad';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { MaliniError, SHARED_ERROR_VERDICTS } from '$main/errors';
import { isScratchpadContent } from '../domain/scratchpad';
import { readScratchpad, writeScratchpad } from './scratchpads.repository';

class ScratchpadError extends MaliniError<keyof typeof SHARED_ERROR_VERDICTS> {
	constructor(kind: keyof typeof SHARED_ERROR_VERDICTS, message: string) {
		super('ScratchpadError', SHARED_ERROR_VERDICTS, kind, message);
	}
}

export function registerScratchpad(context: MainContext): void {
	const { db, commands } = context;

	commands.define('scratchpad.load', (args: unknown) =>
		readScratchpad(db, repositoryFullName(args)),
	);

	commands.define('scratchpad.save', (args: unknown) => {
		writeScratchpad(db, repositoryFullName(args), content(args));
	});
}

function repositoryFullName(args: unknown): string {
	const value = isRecord(args) ? args['repositoryFullName'] : undefined;
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > REPOSITORY_FULL_NAME_MAX_LENGTH
	) {
		throw new ScratchpadError(
			'invalid-argument',
			'invalid args: `repositoryFullName` must be a repository name',
		);
	}
	return value.trim();
}

function content(args: unknown): string {
	const value = isRecord(args) ? args['content'] : undefined;
	if (
		typeof value !== 'string' ||
		value.length > SCRATCHPAD_CONTENT_MAX_LENGTH ||
		!isScratchpadContent(value)
	) {
		throw new ScratchpadError(
			'invalid-argument',
			'invalid args: `content` must be a scratchpad document',
		);
	}
	return value;
}
