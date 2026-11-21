import type { Workstream } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';
import {
	getWorkstream,
	githubFullNameFromRemote,
	resolveConnectedRepository,
	type ConnectedRepository,
} from '$shared/repositories/repositories.platform';

const SHIP_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'nothing-to-ship': 'expected',
	'not-github': 'expected',
	'unknown-workstream': 'bug',
	'not-queued': 'expected',
	'unknown-repository': 'bug',
	'no-checkout': 'expected',
	'pull-request-missing': 'bug',
	'head-moved': 'expected',
	'empty-title': 'expected',
} as const satisfies ErrorVerdicts;

export type ShipErrorKind = keyof typeof SHIP_ERROR_VERDICTS;

export class ShipError extends MaliniError<ShipErrorKind> {
	constructor(kind: ShipErrorKind, message: string) {
		super('ShipError', SHIP_ERROR_VERDICTS, kind, message);
	}
}

export type ShipTarget = Readonly<{
	workstream: Workstream;
	repository: ConnectedRepository;
	repoId: string;
	base: string;
}>;

export async function shipTarget(db: MaliniDatabase, workstreamId: string): Promise<ShipTarget> {
	const workstream = getWorkstream(db, workstreamId);
	if (!workstream) {
		throw new ShipError('unknown-workstream', `Unknown workstream: ${workstreamId}`);
	}
	const repository = await resolveConnectedRepository(db, workstream.projectId);
	if (!repository || githubFullNameFromRemote(repository.remoteUrl ?? '') === null) {
		throw new ShipError(
			'not-github',
			'Connect this workstream to a GitHub repository to open a pull request.',
		);
	}
	return {
		workstream,
		repository,
		repoId: workstream.projectId,
		base: workstream.baseBranch || repository.defaultBranch,
	};
}
