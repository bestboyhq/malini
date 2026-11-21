import { MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';

const STATS_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'signed-out': 'expected',
	'stop-failed': 'bug',
} as const satisfies ErrorVerdicts;

export type StatsErrorKind = keyof typeof STATS_ERROR_VERDICTS;

export class StatsError extends MaliniError<StatsErrorKind> {
	constructor(kind: StatsErrorKind, message: string) {
		super('StatsError', STATS_ERROR_VERDICTS, kind, message);
	}
}
