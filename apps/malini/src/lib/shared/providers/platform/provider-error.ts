import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const PROVIDER_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'not-found': 'bug',
	'key-invalid': 'expected',
	'key-missing': 'expected',
	'key-rejected': 'expected',
	'key-unreadable': 'expected',
	'keychain-locked': 'expected',
	'signed-out': 'expected',
	'not-installed': 'expected',
	unreachable: 'expected',
	unsupported: 'expected',
	'sign-in-failed': 'bug',
	'proxy-stopped': 'bug',
} as const satisfies ErrorVerdicts;

export type ProviderErrorKind = keyof typeof PROVIDER_ERROR_VERDICTS;

export class ProviderError extends MaliniError<ProviderErrorKind> {
	constructor(kind: ProviderErrorKind, message: string, cause?: unknown) {
		super('ProviderError', PROVIDER_ERROR_VERDICTS, kind, message, {
			code: errorCode(cause),
			cause,
		});
	}
}
