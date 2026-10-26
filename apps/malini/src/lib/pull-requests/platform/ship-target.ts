import type { Workstream } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import {
	getWorkstream,
	githubFullNameFromRemote,
	resolveConnectedRepository,
	type ConnectedRepository,
} from '$shared/repositories/repositories.platform';

export type ShipErrorKind = 'nothing-to-ship' | 'not-github' | 'unknown-workstream' | 'not-queued';

export class ShipError extends Error {
	readonly kind: ShipErrorKind;

	constructor(kind: ShipErrorKind, message: string) {
		super(message);
		this.name = 'ShipError';
		this.kind = kind;
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
