import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLONE_FLAGS = process.platform === 'darwin' ? ['-c'] : ['--reflink=auto', '-p'];

export async function cloneInto(sources: readonly string[], directory: string): Promise<void> {
	if (sources.length === 0) return;
	await execFileAsync('/bin/cp', [...CLONE_FLAGS, '-R', '--', ...sources, directory]);
}

export async function cloneFile(source: string, target: string): Promise<void> {
	await execFileAsync('/bin/cp', [...CLONE_FLAGS, '--', source, target]);
}
