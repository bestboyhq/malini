import { constants } from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	rmdir,
	stat,
	symlink,
	unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { CheckoutsFolder, CheckoutsFolderProblem } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, run } from '$main/db/rows';
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
const CHOSEN_FOLDER_SETTING = 'checkouts.folder';
const MOVE_FAILURE_SETTING = 'checkouts.move-failure';
const REINSTALL_SETTING = 'checkouts.reinstall';
const PROBLEMS: readonly CheckoutsFolderProblem[] = [
	'inside-checkouts',
	'other-disk',
	'not-empty',
	'not-writable',
	'move-failed',
];
const IGNORED_ENTRIES = new Set(['.DS_Store']);
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

type Undo = () => Promise<unknown>;

export interface CheckoutsMove {
	readonly db: MaliniDatabase;
	readonly appDataRoot: string;
	readonly defaultRoot: string;
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
	defaultRoot,
	claudeDirectory = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'),
}: CheckoutsMove): Promise<string> {
	const home = readFolder(db, CHECKOUTS_HOME_SETTING, appDataRoot);
	const chosen = readFolder(db, CHOSEN_FOLDER_SETTING, appDataRoot);
	const from = home ?? appDataRoot;
	const to = chosen ?? home ?? defaultRoot;
	if (from === to) return from;
	const resumed = chosen !== null && moveStarted(db);
	const problem = chosen && !resumed ? await folderProblem(to, from) : await otherDisk(to, from);
	if (problem) return keepCheckouts(db, from, to, problem, resumed);
	writeSetting(
		db,
		CHOSEN_FOLDER_SETTING,
		JSON.stringify({ appData: appDataRoot, folder: to, started: true }),
	);
	const undo: Undo[] = [];
	try {
		for (const name of MOVED_FOLDERS) {
			await unlinkLinkTo(join(to, name), join(from, name), undo);
			await moveFolder(join(from, name), join(to, name), undo);
		}
	} catch (error) {
		console.error(`malini: checkouts stay in ${from}: ${describeError(error)}`);
		for (const step of undo.reverse()) await settle('put a checkout back', step);
		await linkMovedFolders(from, to);
		return keepCheckouts(db, from, to, 'move-failed', resumed);
	}
	await settle('repair the moved worktrees', () => repairWorktrees(from, to));
	await settle('record the moved checkout paths', async () => rewriteRecordedPaths(db, from, to));
	await settle("move Claude Code's chat records", () =>
		moveChatRecords(join(claudeDirectory, 'projects'), from, to),
	);
	await linkMovedFolders(from, to);
	await forgetInstalls(db, join(to, WORKSTREAMS_DIR_NAME) + sep);
	db.transaction(() => {
		writeFolder(db, CHECKOUTS_HOME_SETTING, appDataRoot, to);
		deleteSetting(db, CHOSEN_FOLDER_SETTING);
		deleteSetting(db, MOVE_FAILURE_SETTING);
	});
	return to;
}

export function checkoutsFolder(
	db: MaliniDatabase,
	appDataRoot: string,
	current: string,
): CheckoutsFolder {
	return {
		folder: current,
		next: readFolder(db, CHOSEN_FOLDER_SETTING, appDataRoot),
		home: homedir(),
		problem: readFailure(db),
	};
}

export async function chooseCheckoutsFolder(
	db: MaliniDatabase,
	appDataRoot: string,
	current: string,
	picked: string,
): Promise<CheckoutsFolder> {
	const folder = await realpath(picked);
	deleteSetting(db, MOVE_FAILURE_SETTING);
	if (folder === (await realpath(current).catch(() => current))) {
		return keepCheckoutsFolder(db, appDataRoot, current);
	}
	const reason = await folderProblem(folder, current);
	if (reason) return { ...checkoutsFolder(db, appDataRoot, current), problem: { folder, reason } };
	writeFolder(db, CHOSEN_FOLDER_SETTING, appDataRoot, folder);
	return checkoutsFolder(db, appDataRoot, current);
}

export function keepCheckoutsFolder(
	db: MaliniDatabase,
	appDataRoot: string,
	current: string,
): CheckoutsFolder {
	db.transaction(() => {
		deleteSetting(db, CHOSEN_FOLDER_SETTING);
		deleteSetting(db, MOVE_FAILURE_SETTING);
	});
	return checkoutsFolder(db, appDataRoot, current);
}

function keepCheckouts(
	db: MaliniDatabase,
	from: string,
	to: string,
	reason: CheckoutsFolderProblem,
	resumed: boolean,
): string {
	db.transaction(() => {
		if (!resumed) deleteSetting(db, CHOSEN_FOLDER_SETTING);
		writeSetting(db, MOVE_FAILURE_SETTING, JSON.stringify({ folder: to, reason }));
	});
	return from;
}

async function folderProblem(
	folder: string,
	current: string,
): Promise<CheckoutsFolderProblem | null> {
	const here = await realpath(current).catch(() => current);
	if (within(folder, here)) return 'inside-checkouts';
	const disk = await otherDisk(folder, here);
	if (disk) return disk;
	if (!(await holdsNothing(folder, here))) return 'not-empty';
	return (await writable(folder)) ? null : 'not-writable';
}

async function writable(folder: string): Promise<boolean> {
	try {
		await access(await existingAncestor(folder), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

async function otherDisk(folder: string, current: string): Promise<'other-disk' | null> {
	const [there, here] = await Promise.all(
		[folder, current].map(async (path) => (await stat(await existingAncestor(path))).dev),
	);
	return there === here ? null : 'other-disk';
}

async function existingAncestor(path: string): Promise<string> {
	let ancestor = path;
	while (!(await lstat(ancestor).catch(() => null)) && dirname(ancestor) !== ancestor) {
		ancestor = dirname(ancestor);
	}
	return ancestor;
}

async function holdsNothing(folder: string, current: string): Promise<boolean> {
	for (const entry of await readdir(folder).catch(() => [])) {
		if (IGNORED_ENTRIES.has(entry)) continue;
		if (!within(await realpath(join(folder, entry)).catch(() => folder), current)) return false;
	}
	return true;
}

function within(path: string, root: string): boolean {
	return path === root || path.startsWith(root + sep);
}

async function unlinkLinkTo(link: string, folder: string, undo: Undo[]): Promise<void> {
	if (!(await lstat(link).catch(() => null))?.isSymbolicLink()) return;
	const [resolved, target] = await Promise.all(
		[link, folder].map((path) => realpath(path).catch(() => null)),
	);
	if (resolved === null || resolved !== target) return;
	const pointsAt = await readlink(link);
	await unlink(link);
	undo.push(() => symlink(pointsAt, link));
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

function deleteSetting(db: MaliniDatabase, key: string): void {
	run(db, 'DELETE FROM settings WHERE key = ?', key);
}

function readFolder(db: MaliniDatabase, key: string, appDataRoot: string): string | null {
	const recorded = parseJson(readSetting(db, key));
	return recorded?.['appData'] === appDataRoot && typeof recorded['folder'] === 'string'
		? recorded['folder']
		: null;
}

function writeFolder(db: MaliniDatabase, key: string, appDataRoot: string, folder: string): void {
	writeSetting(db, key, JSON.stringify({ appData: appDataRoot, folder }));
}

function moveStarted(db: MaliniDatabase): boolean {
	return parseJson(readSetting(db, CHOSEN_FOLDER_SETTING))?.['started'] === true;
}

function readFailure(db: MaliniDatabase): CheckoutsFolder['problem'] {
	const recorded = parseJson(readSetting(db, MOVE_FAILURE_SETTING));
	const reason = PROBLEMS.find((problem) => problem === recorded?.['reason']);
	return reason && typeof recorded?.['folder'] === 'string'
		? { folder: recorded['folder'], reason }
		: null;
}

function parseJson(value: string | null): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(value ?? 'null');
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function activeCheckouts(db: MaliniDatabase, prefix: string): { id: string; path: string }[] {
	return all<{ id: string; path: string }>(
		db,
		"SELECT id, path FROM workstreams WHERE status = 'active' AND substr(path, 1, ?) = ? ORDER BY id",
		prefix.length,
		prefix,
	);
}

async function forgetInstalls(db: MaliniDatabase, prefix: string): Promise<void> {
	const installed: { id: string; marker: string }[] = [];
	for (const { id, path } of activeCheckouts(db, prefix)) {
		const marker = join(path, INSTALL_COMPLETION_PATH);
		if (await lstat(marker).catch(() => null)) installed.push({ id, marker });
	}
	const reinstall = new Set([...pendingReinstalls(db), ...installed.map(({ id }) => id)]);
	writeSetting(db, REINSTALL_SETTING, [...reinstall].join('\n'));
	for (const { id, marker } of installed) {
		await settle(`forget the install of ${id}`, () => rm(marker, { force: true }));
	}
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

async function moveFolder(from: string, to: string, undo: Undo[] = []): Promise<void> {
	if (!(await isFolder(from))) return;
	await mkdir(dirname(to), { recursive: true });
	if (await lstat(to).catch(() => null)) return mergeFolder(from, to, undo);
	await rename(from, to);
	undo.push(() => rename(to, from));
}

async function linkMovedFolders(from: string, to: string): Promise<void> {
	for (const name of MOVED_FOLDERS) {
		const [old, moved] = [join(from, name), join(to, name)];
		await settle(`link the old ${name} folder`, async () => {
			if (!(await lstat(old).catch(() => null)) && (await isFolder(moved))) {
				await symlink(moved, old);
			}
		});
	}
}

async function mergeFolder(from: string, to: string, undo: Undo[]): Promise<void> {
	for (const entry of await readdir(from)) {
		const source = join(from, entry);
		const target = join(to, entry);
		if (!(await lstat(target).catch(() => null))) {
			await rename(source, target);
			undo.push(() => rename(target, source));
		} else if ((await isFolder(source)) && (await isFolder(target))) {
			await mergeFolder(source, target, undo);
		} else {
			console.error(`malini: kept ${source}, since ${target} already exists`);
		}
	}
	try {
		await rmdir(from);
	} catch {
		return;
	}
	undo.push(() => mkdir(from));
}

function movedPath(path: string, from: string, to: string): string | null {
	for (const name of MOVED_FOLDERS) {
		const prefix = join(from, name) + sep;
		if (path.startsWith(prefix)) return join(to, name, path.slice(prefix.length));
	}
	return null;
}

async function repairWorktrees(from: string, to: string): Promise<void> {
	const workstreams = join(to, WORKSTREAMS_DIR_NAME);
	const checkouts = [
		...(await childFolders(workstreams)),
		...(await childFolders(join(workstreams, CHECKOUT_TRASH_DIR_NAME))),
	];
	const stale = new Map<string, string[]>();
	for (const checkout of checkouts) {
		const linked = await readFile(join(checkout, '.git'), 'utf8').catch(() => '');
		const gitdir = /^gitdir:\s*(.+)$/mu.exec(linked)?.[1]?.trim() ?? '';
		const admin = movedPath(gitdir, from, to) ?? gitdir;
		const at = admin.lastIndexOf(WORKTREE_ADMIN);
		if (at < 0) continue;
		const backlink = (await readFile(join(admin, 'gitdir'), 'utf8').catch(() => '')).trim();
		if (admin === gitdir && !movedPath(backlink, from, to)) continue;
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

function rewriteRecordedPaths(db: MaliniDatabase, from: string, to: string): void {
	db.transaction(() => {
		for (const name of MOVED_FOLDERS) {
			const prefix = join(from, name) + sep;
			const moved = join(to, name) + sep;
			for (const { table, column, update } of RECORDED_PATHS) {
				db.prepare(
					`${update} ${table} SET ${column} = ? || substr(${column}, ?) WHERE substr(${column}, 1, ?) = ?`,
				).run(moved, prefix.length + 1, prefix.length, prefix);
			}
		}
	});
}

function chatRecordsFolder(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/gu, '-');
}

async function moveChatRecords(projects: string, from: string, to: string): Promise<void> {
	const entries = await readdir(projects).catch(() => []);
	for (const name of MOVED_FOLDERS) {
		const prefix = chatRecordsFolder(join(from, name) + sep);
		const moved = chatRecordsFolder(join(to, name) + sep);
		for (const entry of entries.filter((candidate) => candidate.startsWith(prefix))) {
			await moveFolder(join(projects, entry), join(projects, moved + entry.slice(prefix.length)));
		}
	}
}
