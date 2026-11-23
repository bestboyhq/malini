import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { errorCode } from '$main/errors';

export const DEFAULT_FILE_MODE = 0o644;

const WINDOWS = process.platform === 'win32';
const HELD_OPEN_BY_ANOTHER_PROCESS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const HELD_OPEN_PATIENCE_MS = 10_000;

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
		await renameWhenFree(staged, target);
	} catch (error) {
		await rm(staged, { force: true });
		throw error;
	}
	syncDirectory(parent);
}

export async function renameWhenFree(from: string, to: string): Promise<void> {
	const giveUpAt = Date.now() + HELD_OPEN_PATIENCE_MS;
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			const heldOpen = WINDOWS && HELD_OPEN_BY_ANOTHER_PROCESS.has(errorCode(error) ?? '');
			if (!heldOpen || Date.now() >= giveUpAt) throw error;
			await sleep(Math.min(100, attempt * 10));
		}
	}
}

export function syncDirectory(path: string): void {
	if (WINDOWS) return;
	const fd = openSync(path, 'r');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
