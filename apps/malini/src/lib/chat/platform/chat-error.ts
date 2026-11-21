import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const CHAT_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'not-found': 'bug',
	'attachment-unavailable': 'bug',
	unrememberable: 'bug',
} as const satisfies ErrorVerdicts;

export type ChatErrorKind = keyof typeof CHAT_ERROR_VERDICTS;

export class ChatError extends MaliniError<ChatErrorKind> {
	constructor(kind: ChatErrorKind, message: string, cause?: unknown) {
		super('ChatError', CHAT_ERROR_VERDICTS, kind, message, { code: errorCode(cause), cause });
	}
}
