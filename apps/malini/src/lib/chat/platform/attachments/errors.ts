import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const ATTACHMENT_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'too-large': 'expected',
	'too-many-files': 'expected',
	'unsupported-type': 'expected',
	'not-a-file': 'expected',
	'unsafe-name': 'bug',
	'unsafe-path': 'bug',
	'not-found': 'bug',
	changed: 'bug',
	unavailable: 'bug',
	io: 'bug',
} as const satisfies ErrorVerdicts;

export type AttachmentErrorKind = keyof typeof ATTACHMENT_ERROR_VERDICTS;

export class AttachmentError extends MaliniError<AttachmentErrorKind> {
	constructor(kind: AttachmentErrorKind, message: string, cause?: unknown) {
		super('AttachmentError', ATTACHMENT_ERROR_VERDICTS, kind, message, {
			code: errorCode(cause),
			cause,
		});
	}
}
