import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const APP_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	io: 'bug',
	'no-window': 'bug',
	'notifications-unsupported': 'bug',
	'secure-storage-unavailable': 'bug',
	'secret-store': 'bug',
	'diagnostics-busy': 'bug',
	'no-update': 'bug',
	'tool-failed': 'bug',
	'sleep-refused': 'bug',
	'not-administrator': 'expected',
	'no-lid-action': 'expected',
	'no-logind': 'expected',
} as const satisfies ErrorVerdicts;

export type AppErrorKind = keyof typeof APP_ERROR_VERDICTS;

export class AppError extends MaliniError<AppErrorKind> {
	constructor(kind: AppErrorKind, message: string, cause?: unknown) {
		super('AppError', APP_ERROR_VERDICTS, kind, message, { code: errorCode(cause), cause });
	}
}
