import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { isErrnoException } from './errors';
import { run } from './db/rows';
import { openMigratedDatabase } from './db/open';
import type { MaliniDatabase } from './db/driver';

export const DATABASE_FILE_NAME = 'malini.sqlite';

const LEGACY_APP_DATA_DIR_NAME = 'smack';
const LEGACY_DATABASE_FILE_NAME = 'smack.sqlite';
const DATABASE_FILE_SUFFIXES = ['', '-wal', '-shm'] as const;
const SINGLETON_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const;
const PATH_COLUMNS = [
	['projects', 'repo_path'],
	['workstreams', 'path'],
	['docker_containers', 'cwd'],
] as const;

export function adoptLegacyAppData(appDataRoot: string): string | null {
	const legacyRoot = join(dirname(appDataRoot), LEGACY_APP_DATA_DIR_NAME);
	if (legacyRoot === appDataRoot || !existsSync(legacyRoot)) return null;
	if (existsSync(appDataRoot) && readdirSync(appDataRoot).length > 0) return null;
	if (isRunning(legacyRoot)) {
		return 'Quit smack, then open malini again. On its first start, malini moves the data of smack into its own folder.';
	}
	try {
		moveAppData(legacyRoot, appDataRoot);
		return null;
	} catch (error) {
		return `malini could not move the data of smack from ${legacyRoot} to ${appDataRoot}: ${
			error instanceof Error ? error.message : String(error)
		}`;
	}
}

function moveAppData(legacyRoot: string, appDataRoot: string): void {
	for (const suffix of DATABASE_FILE_SUFFIXES) {
		const legacy = join(legacyRoot, `${LEGACY_DATABASE_FILE_NAME}${suffix}`);
		if (existsSync(legacy)) renameSync(legacy, join(legacyRoot, `${DATABASE_FILE_NAME}${suffix}`));
	}
	const databasePath = join(legacyRoot, DATABASE_FILE_NAME);
	if (existsSync(databasePath)) {
		const db = openMigratedDatabase(databasePath);
		try {
			relocatePaths(db, legacyRoot, appDataRoot);
		} finally {
			db.close();
		}
	}
	relinkWorktrees(legacyRoot, appDataRoot);
	for (const name of SINGLETON_FILES) rmSync(join(legacyRoot, name), { force: true });
	if (existsSync(appDataRoot)) rmdirSync(appDataRoot);
	renameSync(legacyRoot, appDataRoot);
}

function relocatePaths(db: MaliniDatabase, from: string, to: string): void {
	db.transaction(() => {
		for (const [table, column] of PATH_COLUMNS) {
			run(
				db,
				`UPDATE ${table} SET ${column} = ? || substr(${column}, ?) WHERE substr(${column}, 1, ?) = ?`,
				to,
				[...from].length + 1,
				[...from].length + 1,
				`${from}/`,
			);
		}
	});
}

function relinkWorktrees(legacyRoot: string, appDataRoot: string): void {
	const worktrees = join(legacyRoot, 'workstreams');
	if (!existsSync(worktrees)) return;
	for (const id of readdirSync(worktrees)) {
		const dotGit = join(worktrees, id, '.git');
		if (!existsSync(dotGit) || !lstatSync(dotGit).isFile()) continue;
		const gitdir = readFileSync(dotGit, 'utf8')
			.replace(/^gitdir: /u, '')
			.trim();
		const adminDir = swapRoot(gitdir, appDataRoot, legacyRoot);
		writeFileSync(dotGit, `gitdir: ${swapRoot(gitdir, legacyRoot, appDataRoot)}\n`);
		const backLink = join(adminDir, 'gitdir');
		if (existsSync(backLink))
			writeFileSync(backLink, `${join(appDataRoot, 'workstreams', id, '.git')}\n`);
	}
}

function swapRoot(path: string, from: string, to: string): string {
	return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

function isRunning(legacyRoot: string): boolean {
	let lock: string;
	try {
		lock = readlinkSync(join(legacyRoot, 'SingletonLock'));
	} catch {
		return false;
	}
	const pid = Number(lock.slice(lock.lastIndexOf('-') + 1));
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isErrnoException(error) && error.code === 'EPERM';
	}
}
