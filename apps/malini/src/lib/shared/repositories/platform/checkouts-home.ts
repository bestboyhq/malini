import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	CHECKOUT_TRASH_DIR_NAME,
	CHECKOUTS_DIR_NAME,
	LEGACY_PROJECTS_DIR_NAME,
	REPOSITORIES_DIR_NAME,
	WORKSTREAMS_DIR_NAME,
} from '$main/git/paths';
import { runGit } from '$main/git/run';
import type { CommandRegistry } from '$main/ipc/registry';
import { INSTALL_COMPLETION_PATH } from './provisioning.service';

const CHECKOUTS_HOME_SETTING = 'checkouts.home';
const REINSTALL_SETTING = 'checkouts.reinstall';
const MOVED_FOLDERS = [REPOSITORIES_DIR_NAME, WORKSTREAMS_DIR_NAME, LEGACY_PROJECTS_DIR_NAME];
const WORKTREE_ADMIN = `${sep}.git${sep}worktrees${sep}`;
const RECORDED_PATHS = [
	{ table: 'workstreams', column: 'path', update: 'UPDATE' },
	{ table: 'projects', column: 'repo_path', update: 'UPDATE' },
	{ table: 'connected_repositories', column: 'local_path', update: 'UPDATE' },
	{ table: 'docker_containers', column: 'cwd', update: 'UPDATE' },
	{ table: 'workstream_opened_files', column: 'path', update: 'UPDATE OR REPLACE' },
	{ table: 'mcp_server_listings', column: 'folder', update: 'UPDATE OR REPLACE' },
	{ table: 'mcp_server_folder_offs', column: 'folder', update: 'UPDATE OR REPLACE' },
] as const;

export interface CheckoutsMove {
	readonly db: MaliniDatabase;
	readonly appDataRoot: string;
	readonly checkoutsRoot: string;
	readonly claudeDirectory?: string;
}

export function checkoutsHome(
	appDataRoot: string,
	ownProfile: boolean,
	home: string = homedir(),
): string {
	return ownProfile ? join(appDataRoot, CHECKOUTS_DIR_NAME) : join(home, 'malini');
}

export async function moveCheckoutsHome({
	db,
	appDataRoot,
	checkoutsRoot,
	claudeDirectory = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'),
}: CheckoutsMove): Promise<string> {
	if (appDataRoot === checkoutsRoot || readSetting(db, CHECKOUTS_HOME_SETTING) === checkoutsRoot) {
		return checkoutsRoot;
	}
	const emptied: string[] = [];
	try {
		for (const name of MOVED_FOLDERS) {
			if (await moveFolder(join(appDataRoot, name), join(checkoutsRoot, name))) emptied.push(name);
		}
	} catch (error) {
		console.error(`malini: checkouts stay in ${appDataRoot}: ${describeError(error)}`);
		return appDataRoot;
	}
	await settle('repair the moved worktrees', () => repairWorktrees(appDataRoot, checkoutsRoot));
	const moved = activeCheckouts(db, join(appDataRoot, WORKSTREAMS_DIR_NAME) + sep).map(
		({ id, path }) => ({ id, path: movedPath(path, appDataRoot, checkoutsRoot) ?? path }),
	);
	await settle('record the moved checkout paths', async () =>
		rewriteRecordedPaths(db, appDataRoot, checkoutsRoot),
	);
	await settle("move Claude Code's chat records", () =>
		moveChatRecords(join(claudeDirectory, 'projects'), appDataRoot, checkoutsRoot),
	);
	for (const name of emptied) {
		await settle(`link the old ${name} folder`, () =>
			symlink(join(checkoutsRoot, name), join(appDataRoot, name)),
		);
	}
	const reinstall = new Set([...pendingReinstalls(db), ...(await forgetInstalls(moved))]);
	db.transaction(() => {
		writeSetting(db, REINSTALL_SETTING, [...reinstall].join('\n'));
		writeSetting(db, CHECKOUTS_HOME_SETTING, checkoutsRoot);
	});
	return checkoutsRoot;
}

export async function reinstallMovedCheckouts(
	db: MaliniDatabase,
	commands: CommandRegistry,
): Promise<void> {
	for (const workstreamId of pendingReinstalls(db)) {
		await settle(`reinstall the dependencies of ${workstreamId}`, () =>
			commands.call('repositories.provision-dependencies', { workstreamId }),
		);
		const left = pendingReinstalls(db).filter((id) => id !== workstreamId);
		writeSetting(db, REINSTALL_SETTING, left.join('\n'));
	}
}

export function pendingReinstalls(db: MaliniDatabase): string[] {
	return (readSetting(db, REINSTALL_SETTING) ?? '').split('\n').filter(Boolean);
}

function readSetting(db: MaliniDatabase, key: string): string | null {
	return get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

function writeSetting(db: MaliniDatabase, key: string, value: string): void {
	run(
		db,
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
		key,
		value,
	);
}

function activeCheckouts(db: MaliniDatabase, prefix: string): { id: string; path: string }[] {
	return all<{ id: string; path: string }>(
		db,
		"SELECT id, path FROM workstreams WHERE status = 'active' AND substr(path, 1, ?) = ? ORDER BY id",
		prefix.length,
		prefix,
	);
}

async function forgetInstalls(
	checkouts: readonly { id: string; path: string }[],
): Promise<string[]> {
	const forgotten: string[] = [];
	for (const { id, path } of checkouts) {
		const marker = join(path, INSTALL_COMPLETION_PATH);
		if (!(await lstat(marker).catch(() => null))) continue;
		await settle(`forget the install of ${id}`, () => rm(marker, { force: true }));
		forgotten.push(id);
	}
	return forgotten;
}

async function settle(step: string, attempt: () => Promise<unknown>): Promise<void> {
	try {
		await attempt();
	} catch (error) {
		console.error(`malini: could not ${step}: ${describeError(error)}`);
	}
}

async function isFolder(path: string): Promise<boolean> {
	return (await lstat(path).catch(() => null))?.isDirectory() ?? false;
}

async function moveFolder(from: string, to: string): Promise<boolean> {
	if (!(await isFolder(from))) return false;
	await mkdir(dirname(to), { recursive: true });
	if (await lstat(to).catch(() => null)) return mergeFolder(from, to);
	await rename(from, to);
	return true;
}

async function mergeFolder(from: string, to: string): Promise<boolean> {
	for (const entry of await readdir(from)) {
		const source = join(from, entry);
		const target = join(to, entry);
		if (!(await lstat(target).catch(() => null))) {
			await rename(source, target);
		} else if ((await isFolder(source)) && (await isFolder(target))) {
			await mergeFolder(source, target);
		} else {
			console.error(`malini: kept ${source}, since ${target} already exists`);
		}
	}
	try {
		await rmdir(from);
		return true;
	} catch {
		return false;
	}
}

function movedPath(path: string, appDataRoot: string, checkoutsRoot: string): string | null {
	for (const name of MOVED_FOLDERS) {
		const prefix = join(appDataRoot, name) + sep;
		if (path.startsWith(prefix)) return join(checkoutsRoot, name, path.slice(prefix.length));
	}
	return null;
}

async function repairWorktrees(appDataRoot: string, checkoutsRoot: string): Promise<void> {
	const workstreams = join(checkoutsRoot, WORKSTREAMS_DIR_NAME);
	const checkouts = [
		...(await childFolders(workstreams)),
		...(await childFolders(join(workstreams, CHECKOUT_TRASH_DIR_NAME))),
	];
	const stale = new Map<string, string[]>();
	for (const checkout of checkouts) {
		const linked = await readFile(join(checkout, '.git'), 'utf8').catch(() => '');
		const gitdir = /^gitdir:\s*(.+)$/mu.exec(linked)?.[1]?.trim() ?? '';
		const admin = movedPath(gitdir, appDataRoot, checkoutsRoot) ?? gitdir;
		const at = admin.lastIndexOf(WORKTREE_ADMIN);
		if (at < 0) continue;
		const backlink = (await readFile(join(admin, 'gitdir'), 'utf8').catch(() => '')).trim();
		if (admin === gitdir && !movedPath(backlink, appDataRoot, checkoutsRoot)) continue;
		const base = admin.slice(0, at);
		stale.set(base, [...(stale.get(base) ?? []), checkout]);
	}
	for (const [base, linked] of stale) {
		await settle(`repair the worktrees of ${base}`, () =>
			runGit(['-C', base, 'worktree', 'repair', ...linked]),
		);
	}
}

async function childFolders(parent: string): Promise<string[]> {
	const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => join(parent, entry.name));
}

function rewriteRecordedPaths(
	db: MaliniDatabase,
	appDataRoot: string,
	checkoutsRoot: string,
): void {
	db.transaction(() => {
		for (const name of MOVED_FOLDERS) {
			const from = join(appDataRoot, name) + sep;
			const to = join(checkoutsRoot, name) + sep;
			for (const { table, column, update } of RECORDED_PATHS) {
				db.prepare(
					`${update} ${table} SET ${column} = ? || substr(${column}, ?) WHERE substr(${column}, 1, ?) = ?`,
				).run(to, from.length + 1, from.length, from);
			}
		}
	});
}

function chatRecordsFolder(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/gu, '-');
}

async function moveChatRecords(
	projects: string,
	appDataRoot: string,
	checkoutsRoot: string,
): Promise<void> {
	const entries = await readdir(projects).catch(() => []);
	for (const name of MOVED_FOLDERS) {
		const from = chatRecordsFolder(join(appDataRoot, name) + sep);
		const to = chatRecordsFolder(join(checkoutsRoot, name) + sep);
		for (const entry of entries.filter((candidate) => candidate.startsWith(from))) {
			await moveFolder(join(projects, entry), join(projects, to + entry.slice(from.length)));
		}
	}
}
