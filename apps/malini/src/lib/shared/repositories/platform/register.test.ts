import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { ProjectDto, WorkstreamDto } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject } from './projects.repository';
import { registerRepositories } from './register';
import type { RepositoriesPlatform } from '../repositories.platform';
import { upsertWorkstream } from './workstreams.repository';

const execFileAsync = promisify(execFile);

let root: string;
let db: MaliniDatabase;
let context: MainContext;
let platform: RepositoriesPlatform;

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, { cwd });
	return stdout;
}

async function initRepo(path: string): Promise<void> {
	mkdirSync(path, { recursive: true });
	await git(path, ['init', '-q', '-b', 'main']);
	await git(path, ['config', 'user.email', 't@example.com']);
	await git(path, ['config', 'user.name', 't']);
	writeFileSync(join(path, 'seed.txt'), 'seed\n');
	await git(path, ['add', '.']);
	await git(path, ['commit', '-q', '-m', 'seed']);
}

function seedProject(id: string, repoPath: string): void {
	upsertProject(db, {
		id,
		name: id,
		repoPath,
		defaultBranch: 'main',
		createdAt: '2026-09-18T00:00:00.000Z',
	});
}

function seedWorkstream(id: string, projectId: string, path: string): void {
	upsertWorkstream(db, {
		id,
		projectId,
		name: id,
		path,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-09-18T00:00:00.000Z',
	});
}

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-repositories-')));
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: root,
		resourcesRoot: root,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	platform = registerRepositories(context, { startupReclaim: false });
});

afterEach(() => {
	platform.watchers.dispose();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('repositories.list-repositories', () => {
	it('answers every row plus its origin remote', async () => {
		const base = join(root, 'repositories', 'p1', 'base');
		await initRepo(base);
		await git(base, ['remote', 'add', 'origin', 'git@github.com:szymeo/blog.dev.git']);
		seedProject('p1', base);
		seedProject('p2', join(root, 'nowhere'));

		const rows = await invoke<ProjectDto[]>('repositories.list-repositories', undefined);
		expect(rows.find((row) => row.id === 'p1')).toEqual({
			id: 'p1',
			name: 'p1',
			repoPath: base,
			defaultBranch: 'main',
			createdAt: '2026-09-18T00:00:00.000Z',
			remoteUrl: 'git@github.com:szymeo/blog.dev.git',
		});
		expect(rows.map((row) => row.id).sort()).toEqual(['p1', 'p2']);
		expect(rows.find((row) => row.id === 'p2')?.remoteUrl).toBeNull();
	});
});

describe('repositories.list-workstreams', () => {
	it('judges each row against the disk: healthy, missing, not a checkout', async () => {
		const base = join(root, 'repositories', 'p1', 'base');
		await initRepo(base);
		seedProject('p1', base);
		const healthy = join(root, 'workstreams', 'ws-healthy');
		await git(base, ['worktree', 'add', '-q', healthy, '-b', 'malini/ws-healthy']);
		seedWorkstream('ws-healthy', 'p1', healthy);
		seedWorkstream('ws-missing', 'p1', join(root, 'workstreams', 'ws-missing'));
		const leftover = join(root, 'workstreams', 'ws-leftover');
		mkdirSync(leftover, { recursive: true });
		seedWorkstream('ws-leftover', 'p1', leftover);

		const rows = await invoke<WorkstreamDto[]>('repositories.list-workstreams', undefined);
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect([...byId.keys()].sort()).toEqual(['ws-healthy', 'ws-leftover', 'ws-missing']);
		expect(byId.get('ws-healthy')).toMatchObject({
			projectId: 'p1',
			branch: 'malini/ws-healthy',
			baseBranch: 'main',
			status: 'active',
			checkoutState: 'healthy',
			checkoutIssue: null,
			resolvedPath: healthy,
		});
		expect(byId.get('ws-missing')).toMatchObject({
			checkoutState: 'missing',
			resolvedPath: null,
		});
		expect(byId.get('ws-missing')?.checkoutIssue).toContain('removed outside the app');
		expect(byId.get('ws-leftover')).toMatchObject({
			checkoutState: 'not-a-checkout',
			resolvedPath: leftover,
		});
	});
});

describe('the returned platform service', () => {
	it('lists the live workstreams and leaves the archived ones out', async () => {
		const base = join(root, 'repositories', 'p1', 'base');
		await initRepo(base);
		seedProject('p1', base);
		const checkout = join(root, 'workstreams', 'ws-1');
		await git(base, ['worktree', 'add', '-q', checkout, '-b', 'malini/ws-1']);
		seedWorkstream('ws-1', 'p1', checkout);
		seedWorkstream('ws-2', 'p1', join(root, 'workstreams', 'ws-2'));
		db.exec("UPDATE workstreams SET status = 'archived' WHERE id = 'ws-2'");

		expect(await platform.checkouts.resolveCheckout('ws-1')).toBe(checkout);
		expect(platform.listLiveWorkstreamIds()).toEqual(['ws-1']);
	});
});
