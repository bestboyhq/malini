import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isErrnoException } from '$main/errors';
import { cloneFile } from '$main/fs/copy-on-write';
import {
	AGENT_ATTACHMENTS_PATH,
	AGENT_CONTEXT_PATH,
	validateWorkstreamId,
	workstreamsRoot,
} from '$main/git/paths';

const KEPT_DIR_NAME = '.kept';
// ponytail: an archived workstream keeps its attachments, the text notes in its context folder and every file its chats showed until it is deleted; age them out if they pile up
const KEPT_FOLDERS = [AGENT_CONTEXT_PATH, AGENT_ATTACHMENTS_PATH] as const;
const SHOWN_DIR_NAME = 'shown';
const PRUNED_MARK = '.pruned';
const KEPT_TEXT_LIMIT_BYTES = 10 * 1024 * 1024;
const TEXT_SNIFF_BYTES = 8192;
const REBUILT_DIRECTORIES = new Set([
	'.build',
	'.cache',
	'.git',
	'.gradle',
	'.next',
	'.nuxt',
	'.parcel-cache',
	'.svelte-kit',
	'.turbo',
	'.venv',
	'.vite',
	'DerivedData',
	'Pods',
	'__pycache__',
	'node_modules',
	'venv',
]);
const BUNDLE_DIRECTORY = /\.(?:app|bundle|dSYM|framework|xcarchive)$/u;

function keptFoldersRoot(appDataRoot: string): string {
	return join(workstreamsRoot(appDataRoot), KEPT_DIR_NAME);
}

function keptFoldersOf(appDataRoot: string, workstreamId: string): string {
	validateWorkstreamId(workstreamId);
	return join(keptFoldersRoot(appDataRoot), workstreamId);
}

export async function keepFolders(
	appDataRoot: string,
	workstreamId: string,
	checkout: string,
): Promise<void> {
	const kept = keptFoldersOf(appDataRoot, workstreamId);
	for (const folder of KEPT_FOLDERS) await moveMerging(join(checkout, folder), join(kept, folder));
}

export async function restoreKeptFolders(
	appDataRoot: string,
	workstreamId: string,
	checkout: string,
): Promise<void> {
	const kept = keptFoldersOf(appDataRoot, workstreamId);
	for (const folder of KEPT_FOLDERS) await moveMerging(join(kept, folder), join(checkout, folder));
	for (const entry of await readdir(kept).catch(() => [])) {
		if (entry !== SHOWN_DIR_NAME) await rm(join(kept, entry), { recursive: true, force: true });
	}
	await rmdir(kept).catch(() => undefined);
}

export async function keepShownFile(
	appDataRoot: string,
	workstreamId: string,
	key: string,
	file: string,
): Promise<void> {
	if (!(await entryAt(file))?.isFile()) return;
	const kept = shownFileOf(appDataRoot, workstreamId, key);
	const partial = `${kept}.${randomUUID()}.partial`;
	await mkdir(dirname(kept), { recursive: true });
	try {
		await cloneFile(file, partial);
		await rename(partial, kept);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}
}

export async function shownFile(
	appDataRoot: string,
	workstreamId: string,
	key: string,
): Promise<string | null> {
	const kept = shownFileOf(appDataRoot, workstreamId, key);
	return (await entryAt(kept)) === null ? null : kept;
}

function shownFileOf(appDataRoot: string, workstreamId: string, key: string): string {
	const name = createHash('sha256').update(key).digest('hex');
	return join(keptFoldersOf(appDataRoot, workstreamId), SHOWN_DIR_NAME, name);
}

export function dropKeptFolders(appDataRoot: string, workstreamId: string): Promise<void> {
	return rm(keptFoldersOf(appDataRoot, workstreamId), { recursive: true, force: true });
}

export async function pruneKeptContext(appDataRoot: string, workstreamId: string): Promise<void> {
	const kept = keptFoldersOf(appDataRoot, workstreamId);
	if ((await entryAt(kept)) === null) return;
	await pruneToSmallText(join(kept, AGENT_CONTEXT_PATH));
	await writeFile(join(kept, PRUNED_MARK), '');
}

export async function keptContextPruned(
	appDataRoot: string,
	workstreamId: string,
): Promise<boolean> {
	return (await entryAt(join(keptFoldersOf(appDataRoot, workstreamId), PRUNED_MARK))) !== null;
}

async function pruneToSmallText(directory: string): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (
			entry.isDirectory() &&
			!REBUILT_DIRECTORIES.has(entry.name) &&
			!BUNDLE_DIRECTORY.test(entry.name)
		) {
			await pruneToSmallText(path);
			await rmdir(path).catch(() => undefined);
			continue;
		}
		if (entry.isFile() && (await isSmallText(path).catch(() => false))) continue;
		await rm(path, { recursive: true, force: true });
	}
}

async function isSmallText(path: string): Promise<boolean> {
	const handle = await open(path, 'r');
	try {
		if ((await handle.stat()).size > KEPT_TEXT_LIMIT_BYTES) return false;
		const { buffer, bytesRead } = await handle.read(
			Buffer.alloc(TEXT_SNIFF_BYTES),
			0,
			TEXT_SNIFF_BYTES,
			0,
		);
		return !buffer.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

export async function sweepKeptFolders(
	appDataRoot: string,
	isWorkstream: (workstreamId: string) => boolean,
): Promise<void> {
	const root = keptFoldersRoot(appDataRoot);
	const entries = await readdir(root).catch(() => []);
	for (const entry of entries) {
		if (!isWorkstream(entry)) await rm(join(root, entry), { recursive: true, force: true });
	}
}

async function moveMerging(from: string, to: string): Promise<void> {
	const source = await entryAt(from);
	if (source === null) return;
	const target = await entryAt(to);
	if (target === null) {
		await mkdir(dirname(to), { recursive: true });
		await rename(from, to);
		return;
	}
	if (!source.isDirectory() || !target.isDirectory()) return;
	for (const entry of await readdir(from)) await moveMerging(join(from, entry), join(to, entry));
}

async function entryAt(path: string): Promise<Stats | null> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
			return null;
		}
		throw error;
	}
}
