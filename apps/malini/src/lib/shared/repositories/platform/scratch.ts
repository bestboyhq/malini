import { userInfo } from 'node:os';
import { join } from 'node:path';
import { promises as originalFs } from 'original-fs';
import { isErrnoException, MaliniError, type ErrorVerdicts } from '$main/errors';
import { validateWorkstreamId } from '$main/git/paths';
import { removeCheckoutDirResilient } from '$main/git/worktrees';

const { lstat, mkdir, readdir } = originalFs;

// ponytail: a live workstream's scratch grows until it is archived or the Mac restarts; age out old entries if one fills the disk first

const FOREIGN_ROOT_VERDICTS: ErrorVerdicts<'foreign-root'> = { 'foreign-root': 'expected' };

export class ScratchRootError extends MaliniError<'foreign-root'> {
	constructor(root: string) {
		super(
			'ScratchRootError',
			FOREIGN_ROOT_VERDICTS,
			'foreign-root',
			`\`${root}\` is not a folder this user owns`,
		);
	}
}

export function scratchRoot(env: NodeJS.ProcessEnv = process.env): string {
	return env['MALINI_SCRATCH_ROOT'] ?? join('/tmp', `malini-${userInfo().uid}`);
}

export function scratchFolder(workstreamId: string, root: string = scratchRoot()): string {
	validateWorkstreamId(workstreamId);
	return join(root, workstreamId);
}

export async function makeScratchFolder(
	workstreamId: string,
	root: string = scratchRoot(),
): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const made = await lstat(root);
	if (!made.isDirectory() || made.uid !== userInfo().uid) {
		throw new ScratchRootError(root);
	}
	const folder = scratchFolder(workstreamId, root);
	await mkdir(folder, { recursive: true });
	return folder;
}

export async function dropScratchFolder(
	workstreamId: string,
	root: string = scratchRoot(),
): Promise<void> {
	const failure = await removeCheckoutDirResilient(scratchFolder(workstreamId, root));
	if (failure !== null) {
		console.error(
			`malini: could not delete the scratch folder of workstream \`${workstreamId}\`: ${failure}`,
		);
	}
}

export async function sweepScratchFolders(
	isArchived: (workstreamId: string) => boolean,
	root: string = scratchRoot(),
): Promise<void> {
	let names: string[];
	try {
		names = await readdir(root);
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ENOENT') return;
		throw error;
	}
	for (const name of names.filter(isArchived)) await dropScratchFolder(name, root);
}
