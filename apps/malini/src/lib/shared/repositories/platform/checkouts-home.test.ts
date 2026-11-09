import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { initRealRepo, realGit, tempDir, workstreamFixture } from '$main/git/fixtures.test-support';
import { workstreamBranchName } from '$main/git/paths';
import { CommandRegistry } from '$main/ipc/registry';
import {
	checkoutsFolder,
	checkoutsHome,
	chooseCheckoutsFolder,
	moveCheckoutsHome,
	pendingReinstalls,
	reinstallMovedCheckouts,
} from './checkouts-home';
import { getProject, upsertProject } from './projects.repository';
import { INSTALL_COMPLETION_PATH } from './provisioning.service';
import { getWorkstream, upsertWorkstream } from './workstreams.repository';

let root: string;
let appData: string;
let home: string;
let claude: string;
let db: MaliniDatabase;
let locked: string[] = [];

function lock(folder: string): void {
	chmodSync(folder, 0o555);
	locked.push(folder);
}

function chatRecords(cwd: string): string {
	return join(claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/gu, '-'));
}

function seed(id: string, projectId: string, repoPath: string, path: string): void {
	const createdAt = '2026-11-07T00:00:00.000Z';
	upsertProject(db, { id: projectId, name: projectId, repoPath, defaultBranch: 'main', createdAt });
	upsertWorkstream(db, {
		id,
		projectId,
		name: id,
		path,
		branch: workstreamBranchName(id),
		baseBranch: 'main',
		status: 'active',
		createdAt,
		scope: null,
		startedBy: null,
	});
}

async function worktreePaths(repo: string): Promise<string[]> {
	const listed = await realGit(repo, ['worktree', 'list', '--porcelain']);
	return [...listed.matchAll(/^worktree (.+)$/gmu)].map((match) => match[1] ?? '');
}

beforeEach(async () => {
	root = realpathSync(await tempDir('malini-checkouts-home-'));
	appData = join(root, 'Application Support', 'malini');
	home = join(root, 'home');
	claude = join(root, 'claude');
	mkdirSync(appData, { recursive: true });
	db = openMigratedDatabase(':memory:');
});

afterEach(() => {
	for (const folder of locked) chmodSync(folder, 0o755);
	locked = [];
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('checkoutsHome', () => {
	it('keeps a profile run inside its profile and everyone else in ~/malini', () => {
		expect(checkoutsHome(appData, true, home)).toBe(join(appData, 'checkouts'));
		expect(checkoutsHome(appData, false, home)).toBe(join(home, 'malini'));
	});
});

describe('moveCheckoutsHome', () => {
	it('moves every checkout, its git links, its records and its chats to the new home', async () => {
		const { base, checkout } = await workstreamFixture(appData, 'ws-1');
		const local = join(root, 'local-repo');
		await initRealRepo(local);
		const localCheckout = join(appData, 'workstreams', 'ws-local');
		await realGit(local, ['worktree', 'add', '-q', localCheckout, '-b', 'malini/ws-local']);
		seed('ws-1', 'proj', base, checkout);
		seed('ws-local', 'local', local, localCheckout);
		mkdirSync(join(checkout, INSTALL_COMPLETION_PATH, '..'), { recursive: true });
		writeFileSync(join(checkout, INSTALL_COMPLETION_PATH), 'fingerprint');
		mkdirSync(chatRecords(checkout), { recursive: true });
		writeFileSync(join(chatRecords(checkout), 'session.jsonl'), '{}\n');
		mkdirSync(chatRecords(local), { recursive: true });
		const checkoutsRoot = join(home, 'malini');
		const moved = (path: string) => join(checkoutsRoot, path.slice(appData.length + 1));

		expect(
			await moveCheckoutsHome({
				db,
				appDataRoot: appData,
				defaultRoot: checkoutsRoot,
				claudeDirectory: claude,
			}),
		).toBe(checkoutsRoot);
		expect(pendingReinstalls(db)).toEqual(['ws-1']);
		for (const name of ['repositories', 'workstreams']) {
			expect(lstatSync(join(appData, name)).isSymbolicLink()).toBe(true);
			expect(realpathSync(join(appData, name))).toBe(join(checkoutsRoot, name));
			rmSync(join(appData, name));
		}
		await realGit(moved(base), ['worktree', 'prune']);
		await realGit(local, ['worktree', 'prune']);
		expect(await worktreePaths(moved(base))).toEqual([moved(base), moved(checkout)]);
		expect(await worktreePaths(local)).toEqual([local, moved(localCheckout)]);
		expect((await realGit(moved(checkout), ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
			workstreamBranchName('ws-1'),
		);
		expect(getWorkstream(db, 'ws-1')?.path).toBe(moved(checkout));
		expect(getWorkstream(db, 'ws-local')?.path).toBe(moved(localCheckout));
		expect(getProject(db, 'proj')?.repoPath).toBe(moved(base));
		expect(getProject(db, 'local')?.repoPath).toBe(local);
		expect(existsSync(join(chatRecords(moved(checkout)), 'session.jsonl'))).toBe(true);
		expect(existsSync(chatRecords(checkout))).toBe(false);
		expect(existsSync(chatRecords(local))).toBe(true);
		expect(existsSync(join(moved(checkout), INSTALL_COMPLETION_PATH))).toBe(false);

		expect(
			await moveCheckoutsHome({
				db,
				appDataRoot: appData,
				defaultRoot: checkoutsRoot,
				claudeDirectory: claude,
			}),
		).toBe(checkoutsRoot);
		expect(pendingReinstalls(db)).toEqual(['ws-1']);
	});

	it('reinstalls each moved checkout, and a later launch finishes what a quit cut short', async () => {
		const checkoutsRoot = join(home, 'malini');
		for (const id of ['ws-1', 'ws-2']) {
			const checkout = join(appData, 'workstreams', id);
			seed(id, 'proj', join(appData, 'repositories', 'proj', 'base'), checkout);
			mkdirSync(join(checkout, INSTALL_COMPLETION_PATH, '..'), { recursive: true });
			writeFileSync(join(checkout, INSTALL_COMPLETION_PATH), 'fingerprint');
		}
		await moveCheckoutsHome({
			db,
			appDataRoot: appData,
			defaultRoot: checkoutsRoot,
			claudeDirectory: claude,
		});
		const installed: string[] = [];
		const launch = (finishes: (workstreamId: string) => boolean) => {
			const commands = new CommandRegistry();
			commands.define('repositories.provision-dependencies', (args) => {
				const { workstreamId } = args as { workstreamId: string };
				installed.push(workstreamId);
				return finishes(workstreamId)
					? Promise.resolve({ status: 'succeeded' })
					: new Promise(() => {});
			});
			return commands;
		};

		void reinstallMovedCheckouts(
			db,
			launch((workstreamId) => workstreamId === 'ws-1'),
		);
		await vi.waitFor(() => expect(installed).toEqual(['ws-1', 'ws-2']));
		expect(pendingReinstalls(db)).toEqual(['ws-2']);
		await reinstallMovedCheckouts(
			db,
			launch(() => true),
		);

		expect(installed).toEqual(['ws-1', 'ws-2', 'ws-2']);
		expect(pendingReinstalls(db)).toEqual([]);
	});

	it('merges into a home that already holds checkouts', async () => {
		const checkoutsRoot = join(home, 'malini');
		mkdirSync(join(appData, 'workstreams', 'ws-old'), { recursive: true });
		mkdirSync(join(checkoutsRoot, 'workstreams', 'ws-new'), { recursive: true });

		await moveCheckoutsHome({
			db,
			appDataRoot: appData,
			defaultRoot: checkoutsRoot,
			claudeDirectory: claude,
		});

		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-old'))).toBe(true);
		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-new'))).toBe(true);
		expect(lstatSync(join(appData, 'workstreams')).isSymbolicLink()).toBe(true);
	});

	it('moves checkouts to a folder you choose, and back again', async () => {
		const { base, checkout } = await workstreamFixture(appData, 'ws-1');
		seed('ws-1', 'proj', base, checkout);
		const malini = join(home, 'malini');
		const chosen = join(root, 'code', 'checkouts');
		mkdirSync(chosen, { recursive: true });
		const move = () =>
			moveCheckoutsHome({ db, appDataRoot: appData, defaultRoot: malini, claudeDirectory: claude });
		const at = (folder: string, path = checkout) => join(folder, path.slice(appData.length + 1));
		await move();

		expect((await chooseCheckoutsFolder(db, appData, malini, chosen)).next).toBe(chosen);
		expect(await move()).toBe(chosen);
		expect(checkoutsFolder(db, appData, chosen)).toMatchObject({ folder: chosen, next: null });
		expect(getWorkstream(db, 'ws-1')?.path).toBe(at(chosen));
		expect(realpathSync(join(malini, 'workstreams'))).toBe(join(chosen, 'workstreams'));
		expect((await chooseCheckoutsFolder(db, appData, chosen, malini)).problem).toBeNull();
		expect(await move()).toBe(malini);

		expect(lstatSync(join(malini, 'workstreams')).isDirectory()).toBe(true);
		expect(realpathSync(join(chosen, 'workstreams'))).toBe(join(malini, 'workstreams'));
		expect(getWorkstream(db, 'ws-1')?.path).toBe(at(malini));
		expect(getProject(db, 'proj')?.repoPath).toBe(at(malini, base));
		for (const folder of [appData, chosen]) {
			for (const name of ['repositories', 'workstreams']) rmSync(join(folder, name));
		}
		await realGit(at(malini, base), ['worktree', 'prune']);
		expect(await worktreePaths(at(malini, base))).toEqual([at(malini, base), at(malini)]);
	});

	it('finishes a move that a quit cut short after it renamed the folders', async () => {
		const { base, checkout } = await workstreamFixture(appData, 'ws-1');
		seed('ws-1', 'proj', base, checkout);
		const malini = join(home, 'malini');
		const chosen = join(root, 'chosen');
		mkdirSync(chosen);
		const move = () =>
			moveCheckoutsHome({ db, appDataRoot: appData, defaultRoot: malini, claudeDirectory: claude });
		const at = (folder: string, path = checkout) => join(folder, path.slice(appData.length + 1));
		await move();
		mkdirSync(join(at(malini), INSTALL_COMPLETION_PATH, '..'), { recursive: true });
		writeFileSync(join(at(malini), INSTALL_COMPLETION_PATH), 'fingerprint');
		await chooseCheckoutsFolder(db, appData, malini, chosen);
		db.prepare("UPDATE settings SET value = ? WHERE key = 'checkouts.folder'").run(
			JSON.stringify({ appData, folder: chosen, started: true }),
		);
		db.prepare("UPDATE settings SET value = '' WHERE key = 'checkouts.reinstall'").run();
		for (const name of ['repositories', 'workstreams']) {
			renameSync(join(malini, name), join(chosen, name));
		}
		seed('ws-1', 'proj', at(chosen, base), at(chosen));

		expect(await move()).toBe(chosen);

		expect(checkoutsFolder(db, appData, chosen)).toMatchObject({ next: null, problem: null });
		expect(getWorkstream(db, 'ws-1')?.path).toBe(at(chosen));
		expect(pendingReinstalls(db)).toEqual(['ws-1']);
		expect(existsSync(join(at(chosen), INSTALL_COMPLETION_PATH))).toBe(false);
		for (const name of ['repositories', 'workstreams']) {
			expect(realpathSync(join(malini, name))).toBe(join(chosen, name));
			rmSync(join(malini, name));
			rmSync(join(appData, name));
		}
		await realGit(at(chosen, base), ['worktree', 'prune']);
		expect(await worktreePaths(at(chosen, base))).toEqual([at(chosen, base), at(chosen)]);
	});

	it('refuses a folder it cannot move checkouts into, and keeps the one you chose', async () => {
		const current = join(home, 'malini');
		const empty = join(root, 'empty');
		const full = join(root, 'full');
		const locked = join(root, 'locked');
		mkdirSync(join(current, 'workstreams'), { recursive: true });
		for (const folder of [empty, full, locked]) mkdirSync(folder, { recursive: true });
		writeFileSync(join(empty, '.DS_Store'), '');
		writeFileSync(join(full, 'notes.md'), '');
		lock(locked);
		const refusal = async (folder: string) =>
			(await chooseCheckoutsFolder(db, appData, current, folder)).problem?.reason ?? null;

		expect((await chooseCheckoutsFolder(db, appData, current, empty)).next).toBe(empty);
		expect(await refusal(full)).toBe('not-empty');
		expect(await refusal(join(current, 'workstreams'))).toBe('inside-checkouts');
		expect(await refusal(locked)).toBe('not-writable');
		expect(await refusal('/dev')).toBe('other-disk');
		expect(checkoutsFolder(db, appData, current).next).toBe(empty);
		expect((await chooseCheckoutsFolder(db, appData, current, current)).next).toBeNull();
	});

	it('puts back what it moved when a move fails, and keeps checkouts where they were', async () => {
		const chosen = join(root, 'chosen');
		mkdirSync(join(appData, 'repositories', 'proj'), { recursive: true });
		mkdirSync(join(appData, 'workstreams', 'ws-1'), { recursive: true });
		mkdirSync(chosen);
		lock(join(appData, 'workstreams'));
		await moveCheckoutsHome({
			db,
			appDataRoot: appData,
			defaultRoot: appData,
			claudeDirectory: claude,
		});
		await chooseCheckoutsFolder(db, appData, appData, chosen);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(
			await moveCheckoutsHome({
				db,
				appDataRoot: appData,
				defaultRoot: appData,
				claudeDirectory: claude,
			}),
		).toBe(appData);

		expect(lstatSync(join(appData, 'repositories', 'proj')).isDirectory()).toBe(true);
		expect(existsSync(join(chosen, 'repositories'))).toBe(false);
		expect(checkoutsFolder(db, appData, appData)).toMatchObject({
			next: null,
			problem: { folder: chosen, reason: 'move-failed' },
		});
	});

	it('ignores the folders a profile copied from another Malini recorded', async () => {
		const theirs = join(root, 'their-checkouts');
		mkdirSync(join(theirs, 'workstreams', 'ws-theirs'), { recursive: true });
		mkdirSync(join(appData, 'workstreams', 'ws-1'), { recursive: true });
		const recorded = JSON.stringify({ appData: join(root, 'their-app-data'), folder: theirs });
		for (const key of ['checkouts.home', 'checkouts.folder']) {
			db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, recorded);
		}
		const checkoutsRoot = join(appData, 'checkouts');

		expect(
			await moveCheckoutsHome({
				db,
				appDataRoot: appData,
				defaultRoot: checkoutsRoot,
				claudeDirectory: claude,
			}),
		).toBe(checkoutsRoot);

		expect(existsSync(join(theirs, 'workstreams', 'ws-theirs'))).toBe(true);
		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-1'))).toBe(true);
		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-theirs'))).toBe(false);
	});
});
