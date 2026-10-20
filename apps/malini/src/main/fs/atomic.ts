import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { errorCode } from '$main/errors';

export const DEFAULT_FILE_MODE = 0o644;

export interface AtomicReplaceOptions {
	readonly defaultMode?: number;
}

export async function atomicReplaceFile(
	target: string,
	contents: string,
	options: AtomicReplaceOptions = {},
): Promise<void> {
	const parent = dirname(target);
	await mkdir(parent, { recursive: true });
	let mode = options.defaultMode ?? DEFAULT_FILE_MODE;
	try {
		mode = (await stat(target)).mode & 0o7777;
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw error;
	}
	const staged = join(parent, `.${randomBytes(8).toString('hex')}.tmp`);
	const handle = await open(staged, 'wx', mode);
	try {
		try {
			await handle.chmod(mode);
			await handle.writeFile(contents, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(staged, target);
	} catch (error) {
		await rm(staged, { force: true });
		throw error;
	}
	syncDirectory(parent);
}

export function syncDirectory(path: string): void {
	const fd = openSync(path, 'r');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
