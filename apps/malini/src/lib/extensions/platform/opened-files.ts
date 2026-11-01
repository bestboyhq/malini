import { mkdir, open, readFile as readFileBytes, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ExtensionFileStat } from '$contract/system';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { get, run } from '$main/db/rows';
import { describeError, errorCode } from '$main/errors';
import { atomicReplaceFile } from '$main/fs/atomic';
import { isInsideDirectory } from '$main/fs/paths';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SHARED_FILE_MODE = 0o644;

export type OpenFileForUserDeps = Pick<MainContext, 'db' | 'events'>;

export type OpenFileForUserInput = Readonly<{
	workstreamId: string;
	worktree: string;
	path: string;
	line: number | null;
}>;

export type OpenedFile = Readonly<{ path: string; created: boolean }>;

export async function openFileForUser(
	{ db, events }: OpenFileForUserDeps,
	input: OpenFileForUserInput,
): Promise<OpenedFile> {
	const root = await realpath(input.worktree);
	const requested = await canonicalPath(requestedPath(input.path, root));
	refuseGitInternals(root, requested);
	const created = await createMissingFile(requested, !isInsideDirectory(root, requested));
	const target = await realpath(requested);
	if (!(await stat(target)).isFile()) throw new Error(`${input.path} is not a file.`);
	refuseGitInternals(root, target);
	const path = workstreamPath(root, target);
	if (isAbsolute(path)) {
		run(
			db,
			`INSERT INTO workstream_opened_files (workstream_id, path, opened_at) VALUES (?, ?, ?)
			 ON CONFLICT (workstream_id, path) DO UPDATE SET opened_at = excluded.opened_at`,
			input.workstreamId,
			path,
			new Date().toISOString(),
		);
	}
	events.emit('extensions:file-open-requested', {
		workstreamId: input.workstreamId,
		path,
		line: input.line,
	});
	return { path, created };
}

export async function readOpenedFile(
	db: MaliniDatabase,
	workstreamId: string,
	path: string,
): Promise<string> {
	const target = openedFile(db, workstreamId, path);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(await readFileBytes(target));
	} catch (error) {
		throw new Error(`Could not read ${path}: ${describeError(error)}`);
	}
}

export async function writeOpenedFile(
	db: MaliniDatabase,
	workstreamId: string,
	path: string,
	contents: string,
): Promise<void> {
	const target = await canonicalPath(openedFile(db, workstreamId, path));
	try {
		await atomicReplaceFile(target, contents, { defaultMode: PRIVATE_FILE_MODE });
	} catch (error) {
		throw new Error(`Could not save ${path}: ${describeError(error)}`);
	}
}

export async function statOpenedFile(
	db: MaliniDatabase,
	workstreamId: string,
	path: string,
): Promise<ExtensionFileStat | null> {
	const target = openedFile(db, workstreamId, path);
	try {
		const metadata = await stat(target);
		if (metadata.isFile()) return { kind: 'file', size: metadata.size };
		if (metadata.isDirectory()) return { kind: 'directory', size: metadata.size };
		return null;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;
		throw new Error(`Could not stat ${path}: ${describeError(error)}`);
	}
}

function openedFile(db: MaliniDatabase, workstreamId: string, path: string): string {
	const granted = get<{ path: string }>(
		db,
		'SELECT path FROM workstream_opened_files WHERE workstream_id = ? AND path = ?',
		workstreamId,
		path,
	);
	if (!granted) throw new Error(`${path} is outside this workstream and was not opened in it.`);
	return granted.path;
}

function workstreamPath(root: string, path: string): string {
	return isInsideDirectory(root, path) ? relative(root, path).split(sep).join('/') : path;
}

function refuseGitInternals(root: string, path: string): void {
	const inWorkstream = workstreamPath(root, path);
	if (!isAbsolute(inWorkstream) && inWorkstream.split('/').includes('.git')) {
		throw new Error('Malini does not open files inside .git.');
	}
}

function requestedPath(path: string, root: string): string {
	if (path.trim() === '') throw new Error('Name the file to open.');
	if (path.includes('\0')) throw new Error('The path contains a null byte.');
	if (path === '~') return homedir();
	if (path.startsWith('~/')) return join(homedir(), path.slice(2));
	if (path.startsWith('~')) throw new Error(`Write ${path} as an absolute path or one under ~/.`);
	return resolve(root, path);
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw error;
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(await canonicalPath(parent), basename(path));
	}
}

async function createMissingFile(path: string, outsideWorktree: boolean): Promise<boolean> {
	await mkdir(dirname(path), {
		recursive: true,
		...(outsideWorktree ? { mode: PRIVATE_DIRECTORY_MODE } : {}),
	});
	try {
		const mode = outsideWorktree ? PRIVATE_FILE_MODE : SHARED_FILE_MODE;
		const handle = await open(path, 'wx', mode);
		await handle.close();
		return true;
	} catch (error) {
		if (errorCode(error) === 'EEXIST') return false;
		throw new Error(`Could not create ${path}: ${describeError(error)}`);
	}
}
