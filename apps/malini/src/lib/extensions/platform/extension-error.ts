import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const EXTENSION_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'package-invalid': 'bug',
	'local-extension-invalid': 'expected',
	'signed-out': 'expected',
	'no-handle': 'expected',
	uncommitted: 'expected',
	'name-taken': 'expected',
	'limit-reached': 'expected',
	'package-mismatch': 'bug',
	withdrawn: 'bug',
	'not-installed': 'bug',
	'not-found': 'bug',
	'not-a-file': 'bug',
	'path-refused': 'bug',
	io: 'bug',
} as const satisfies ErrorVerdicts;

export type ExtensionErrorKind = keyof typeof EXTENSION_ERROR_VERDICTS;

export class ExtensionError extends MaliniError<ExtensionErrorKind> {
	constructor(kind: ExtensionErrorKind, message: string, cause?: unknown) {
		super('ExtensionError', EXTENSION_ERROR_VERDICTS, kind, message, {
			code: errorCode(cause),
			cause,
		});
	}
}
