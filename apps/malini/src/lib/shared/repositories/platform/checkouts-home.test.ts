import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { initRealRepo, realGit, tempDir, workstreamFixture } from '$main/git/fixtures.test-support';
import { workstreamBranchName } from '$main/git/paths';
import { CommandRegistry } from '$main/ipc/registry';
import {
	checkoutsHome,
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
			await moveCheckoutsHome({ db, appDataRoot: appData, checkoutsRoot, claudeDirectory: claude }),
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
			await moveCheckoutsHome({ db, appDataRoot: appData, checkoutsRoot, claudeDirectory: claude }),
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
		await moveCheckoutsHome({ db, appDataRoot: appData, checkoutsRoot, claudeDirectory: claude });
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

		await moveCheckoutsHome({ db, appDataRoot: appData, checkoutsRoot, claudeDirectory: claude });

		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-old'))).toBe(true);
		expect(existsSync(join(checkoutsRoot, 'workstreams', 'ws-new'))).toBe(true);
		expect(lstatSync(join(appData, 'workstreams')).isSymbolicLink()).toBe(true);
	});
});
