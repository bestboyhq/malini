import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MINIMUM_FREE_BYTES = 2e9;

const USABLE_CAPACITY_TIMEOUT_MS = 5_000;

const USABLE_CAPACITY_SCRIPT = `ObjC.import('Foundation');
function run(argv) {
	const key = $.NSURLVolumeAvailableCapacityForImportantUsageKey;
	const values = $.NSURL.fileURLWithPath(argv[0]).resourceValuesForKeysError($([key]), null);
	return String(values.objectForKey(key).js);
}`;

export async function requireFreeSpace(path: string, needed: number, task: string): Promise<void> {
	const volume = nearestExisting(path);
	const free = await freeBytes(volume);
	if (free >= needed) return;
	const usable = Math.max(free, (await usableBytes(volume)) ?? 0);
	if (usable >= needed) return;
	throw new Error(
		`Only ${gigabytes(usable)} is free, and ${task} needs ${gigabytes(needed)}. Archive old workstreams or free up space.`,
	);
}

function nearestExisting(path: string): string {
	let current = path;
	while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
	return current;
}

async function freeBytes(path: string): Promise<number> {
	const { bavail, bsize } = await statfs(path);
	return bavail * bsize;
}

async function usableBytes(path: string): Promise<number | null> {
	try {
		const { stdout } = await execFileAsync(
			'/usr/bin/osascript',
			['-l', 'JavaScript', '-e', USABLE_CAPACITY_SCRIPT, path],
			{ timeout: USABLE_CAPACITY_TIMEOUT_MS },
		);
		const bytes = Number(stdout.trim());
		return Number.isFinite(bytes) ? bytes : null;
	} catch {
		return null;
	}
}

function gigabytes(bytes: number): string {
	return `${Number((bytes / 1e9).toFixed(1))} GB`;
}
