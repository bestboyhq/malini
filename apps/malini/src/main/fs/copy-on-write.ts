import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS = process.platform === 'win32';
const CLONE_FLAGS = process.platform === 'darwin' ? ['-c'] : ['--reflink=auto', '-p'];
const NODE_CLONE = {
	recursive: true,
	preserveTimestamps: true,
	verbatimSymlinks: true,
	mode: constants.COPYFILE_FICLONE,
} as const;

export async function cloneInto(sources: readonly string[], directory: string): Promise<void> {
	if (sources.length === 0) return;
	if (!WINDOWS) {
		await execFileAsync('/bin/cp', [...CLONE_FLAGS, '-R', '--', ...sources, directory]);
		return;
	}
	for (const source of sources) await cp(source, join(directory, basename(source)), NODE_CLONE);
}

export async function cloneFile(source: string, target: string): Promise<void> {
	if (WINDOWS) return cp(source, target, NODE_CLONE);
	await execFileAsync('/bin/cp', [...CLONE_FLAGS, '--', source, target]);
}
