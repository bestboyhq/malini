import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const PROCESS_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'spawn-failed': 'bug',
	'signal-failed': 'bug',
} as const satisfies ErrorVerdicts;

export type ProcessErrorKind = keyof typeof PROCESS_ERROR_VERDICTS;

export class ProcessError extends MaliniError<ProcessErrorKind> {
	constructor(kind: ProcessErrorKind, message: string, cause?: unknown) {
		super('ProcessError', PROCESS_ERROR_VERDICTS, kind, message, {
			code: errorCode(cause),
			cause,
		});
	}
}
