import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError, errorCode } from '$main/errors';
import {
	legacyProjectBaseDir,
	repositoryBaseDir,
	resolveWorkstreamCheckoutCanonicalRecorded,
} from '$main/git/paths';
import { getProject } from './projects.repository';
import { getWorkstream } from './workstreams.repository';

export const UNKNOWN_WORKSTREAM = 'Unknown workstream';
export const UNKNOWN_WORKSTREAM_REPOSITORY = 'Unknown workstream repository';
export const UNRESOLVABLE_WORKSTREAM_CHECKOUT = 'Could not resolve workstream checkout';
export const WORKSTREAM_CHECKOUT_NOT_A_DIRECTORY = 'Workstream checkout is not a directory';

export type WorkstreamErrorKind =
	| 'unknown'
	| 'unresolvable'
	| 'not-archived'
	| 'chat-gone'
	| 'repository-gone'
	| 'rollback-failed'
	| 'image-path'
	| 'image-unreadable'
	| 'open-failed';

export class WorkstreamError extends Error {
	override readonly name = 'WorkstreamError';
	readonly kind: WorkstreamErrorKind;
	readonly code: string | null;

	constructor(kind: WorkstreamErrorKind, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.kind = kind;
		this.code = errorCode(cause) ?? null;
	}
}

export interface CheckoutResolver {
	resolveCheckout(workstreamId: string): Promise<string>;
	resolveRepositoryRoot(workstreamId: string): Promise<string>;
}

export interface CheckoutResolverDeps {
	readonly db: MaliniDatabase;
	readonly checkoutsRoot: string;
}

export function recordedCheckoutPath(
	db: MaliniDatabase,
	checkoutsRoot: string,
	workstreamId: string,
): string {
	const recorded = getWorkstream(db, workstreamId)?.path ?? null;
	return resolveWorkstreamCheckoutCanonicalRecorded(checkoutsRoot, workstreamId, recorded);
}

export function recordedBaseRepository(
	db: MaliniDatabase,
	checkoutsRoot: string,
	workstreamId: string,
): string | null {
	const workstream = getWorkstream(db, workstreamId);
	if (!workstream) return null;
	const project = getProject(db, workstream.projectId);
	const candidates = [
		project?.repoPath ?? null,
		repositoryBaseDir(checkoutsRoot, workstream.projectId),
		legacyProjectBaseDir(checkoutsRoot, workstream.projectId),
	];
	for (const candidate of candidates) {
		if (candidate && existsSync(join(candidate, '.git'))) return candidate;
	}
	return null;
}

async function canonicalDirectory(path: string): Promise<string> {
	let canonical: string;
	try {
		canonical = await realpath(path);
	} catch (error) {
		throw new WorkstreamError(
			'unresolvable',
			`${UNRESOLVABLE_WORKSTREAM_CHECKOUT}: ${describeError(error)}`,
			error,
		);
	}
	if (!(await stat(canonical)).isDirectory()) {
		throw new WorkstreamError('unresolvable', WORKSTREAM_CHECKOUT_NOT_A_DIRECTORY);
	}
	return canonical;
}

export function createCheckoutResolver(deps: CheckoutResolverDeps): CheckoutResolver {
	const { db, checkoutsRoot } = deps;
	return {
		async resolveCheckout(workstreamId) {
			if (getWorkstream(db, workstreamId) === null) {
				throw new WorkstreamError('unknown', `${UNKNOWN_WORKSTREAM}: ${workstreamId}`);
			}
			return recordedCheckoutPath(db, checkoutsRoot, workstreamId);
		},
		async resolveRepositoryRoot(workstreamId) {
			const workstream = getWorkstream(db, workstreamId);
			if (workstream === null) {
				throw new WorkstreamError('unknown', `${UNKNOWN_WORKSTREAM}: ${workstreamId}`);
			}
			const project = getProject(db, workstream.projectId);
			if (project === null) {
				throw new Error(`${UNKNOWN_WORKSTREAM_REPOSITORY}: ${workstream.projectId}`);
			}
			return canonicalDirectory(project.repoPath);
		},
	};
}
