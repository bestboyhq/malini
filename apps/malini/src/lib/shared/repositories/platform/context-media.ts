import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { contextMediaCategory, type ContextMedia } from '$contract/workstream-images';
import { errorCode } from '$main/errors';
import { AGENT_CONTEXT_PATH } from '$main/git/paths';

export const MAX_CONTEXT_MEDIA = 1000;

export async function listContextMedia(worktree: string): Promise<ContextMedia[]> {
	const root = await realpath(worktree);
	const folder = join(root, AGENT_CONTEXT_PATH);
	try {
		if (!(await lstat(folder)).isDirectory() || (await realpath(folder)) !== folder) return [];
	} catch (error) {
		if (isGone(error)) return [];
		throw error;
	}
	// ponytail: walks the whole folder and lstats every media file before it keeps the newest 1000; walk with a budget if a .context grows to tens of thousands of files
	const media = await Promise.all(
		(await mediaPathsUnder(folder, AGENT_CONTEXT_PATH)).map(async (path) => {
			const info = await orGone(lstat(join(root, path)));
			const category = contextMediaCategory(path);
			return info?.isFile() && category !== null
				? { path, size: info.size, modifiedAt: info.mtime.toISOString(), category }
				: null;
		}),
	);
	return media
		.filter((item) => item !== null)
		.sort(
			(left, right) =>
				Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt) ||
				left.path.localeCompare(right.path),
		)
		.slice(0, MAX_CONTEXT_MEDIA);
}

async function mediaPathsUnder(folder: string, prefix: string): Promise<string[]> {
	const entries = (await orGone(readdir(folder, { withFileTypes: true }))) ?? [];
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = `${prefix}/${entry.name}`;
			if (entry.isDirectory()) return mediaPathsUnder(join(folder, entry.name), path);
			return entry.isFile() && contextMediaCategory(path) !== null ? [path] : [];
		}),
	);
	return nested.flat();
}

async function orGone<T>(read: Promise<T>): Promise<T | null> {
	try {
		return await read;
	} catch (error) {
		if (isGone(error)) return null;
		throw error;
	}
}

function isGone(error: unknown): boolean {
	return errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';
}
