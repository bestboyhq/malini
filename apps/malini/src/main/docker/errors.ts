import { errorCode, MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const DOCKER_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	failed: 'bug',
	io: 'bug',
	'no-compose-file': 'expected',
} as const satisfies ErrorVerdicts;

export type DockerErrorKind = keyof typeof DOCKER_ERROR_VERDICTS;

export class DockerError extends MaliniError<DockerErrorKind> {
	constructor(kind: DockerErrorKind, message: string, cause?: unknown) {
		super('DockerError', DOCKER_ERROR_VERDICTS, kind, message, { code: errorCode(cause), cause });
	}
}
