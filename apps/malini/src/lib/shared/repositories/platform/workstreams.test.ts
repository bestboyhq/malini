import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { WorktreeAddedPayload } from '$contract/events';
import type {
	ArchivedWorkstreamDto,
	RepositoryConnectionDto,
	WorkstreamDto,
} from '$contract/repositories';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { currentLogPath, diagnosticsDirectory } from '$main/diagnostics/diagnostics-files';
import { MainDiagnosticsLog } from '$main/diagnostics/main-diagnostics';
import { createEventBus } from '$main/events';
import {
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	workstreamFixture,
	writeAttachmentFixture,
} from '$main/git/fixtures.test-support';
import { AGENT_ATTACHMENTS_PATH } from '$main/git/paths';
import type { InvokeResponse } from '$contract/ipc';
import { CommandRegistry } from '$main/ipc/registry';
import type { CheckoutShell } from './checkout-shell.service';
import { listConnectedRepositories } from './connected-repositories.repository';
import { LEAD_SPACE_PROJECT_ID } from '../domain/lead-scope';
import { workstreamLineage } from './lineage.service';
import { getProject, upsertProject } from './projects.repository';
import { registerRepositories, type RepositoriesDeps } from './register';
import { listRepositoryCatalog } from './repository-catalog';
import { archivedLeftoversCleared } from './teardown.service';
import {
	deleteWorkstream,
	getWorkstream,
	listArchivedWorkstreams,
	listWorkstreams,
	upsertWorkstream,
} from './workstreams.repository';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

const silentShell: CheckoutShell = {
	reveal: async () => {},
	openInEditor: async () => {},
};

function harness(appDataRoot: string, deps: RepositoriesDeps = {}) {
	const commands = new CommandRegistry();
	const events = createEventBus({ forwardToWindows: false });
	const context: MainContext = {
		db: openMigratedDatabase(':memory:'),
		commands,
		events,
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	const platform = registerRepositories(context, {
		shell: silentShell,
		startupReclaim: false,
		...deps,
	});
	cleanups.push(async () => {
		platform.watchers.dispose();
		await archivedLeftoversCleared();
		context.db.close();
	});
	async function invoke<T>(command: string, args: unknown): Promise<T>;
	async function invoke(command: string, args: unknown): Promise<unknown> {
		const response = await commands.invoke({ command, args });
		if (!response.ok) throw new Error(response.error);
		return response.value;
	}
	return { commands, events, invoke, db: context.db };
}

function seed(db: MainContext['db'], workstreamId: string, repoPath: string, path: string): void {
	upsertProject(db, {
		id: 'proj',
		name: 'proj',
		repoPath,
		defaultBranch: 'main',
		createdAt: '2026-09-18T00:00:00.000Z',
	});
	upsertWorkstream(db, {
		id: workstreamId,
		projectId: 'proj',
		name: workstreamId,
		path,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-09-18T00:00:00.000Z',
		scope: null,
		startedBy: null,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isWorktreeAddedPayload(value: unknown): value is WorktreeAddedPayload {
	return (
		isRecord(value) &&
		typeof value.workstreamId === 'string' &&
		isRecord(value.project) &&
		isRecord(value.workstream)
	);
}

describe('lead chats', () => {
	it('start in their own lead space and tell the workstreams they start about each other', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const appDataRoot = join(dir, 'app');
		await mkdir(appDataRoot);
		const { invoke, db } = harness(appDataRoot);

		const home = await invoke<WorkstreamDto>('repositories.create-lead', { scope: 'home' });
		const acme = await invoke<WorkstreamDto>('repositories.create-lead', { scope: 'owner:acme' });
		expect([home.scope, acme.scope]).toEqual(['home', 'owner:acme']);
		expect([home.projectId, home.checkoutState, home.startedBy]).toEqual([
			LEAD_SPACE_PROJECT_ID,
			'healthy',
			null,
		]);
		expect(home.name).not.toBe(acme.name);
		await expect(invoke('repositories.create-lead', { scope: 'owner:' })).rejects.toThrow(
			'`scope` must be `home` or `owner:<owner>`',
		);

		const source = join(dir, 'acme', 'api');
		await initRealRepo(source);
		await realGit(source, ['branch', '-M', 'main']);
		const projectRepoPath = await invoke<string>('repositories.create-repository', {
			repoUrl: `file://${source}`,
			defaultBranch: 'main',
		});
		for (const id of ['child-1', 'child-2', 'solo']) {
			await invoke('repositories.create-workstream', {
				projectRepoPath,
				workstreamId: id,
				baseBranch: 'main',
				projectId: 'local__acme__api',
				name: id,
				startedBy: id === 'solo' ? null : acme.id,
			});
		}

		expect((await listRepositoryCatalog(db)).map((repository) => repository.fullName)).toEqual([
			'acme/api',
		]);
		expect(await workstreamLineage(db, 'child-1')).toEqual({
			lead: null,
			startedBy: { name: acme.name, lead: true },
			siblings: [
				{
					repository: 'acme/api',
					branch: 'malini/child-2',
					path: expect.stringMatching(/child-2$/u),
				},
			],
		});
		expect(await workstreamLineage(db, acme.id)).toEqual({
			lead: {
				owner: 'acme',
				repositories: [{ repository: 'acme/api', branch: 'main', path: projectRepoPath }],
			},
			startedBy: null,
			siblings: [],
		});
		expect((await workstreamLineage(db, home.id))?.lead?.repositories).toHaveLength(1);
		expect(await workstreamLineage(db, 'solo')).toBeNull();
	});
});

describe('the workstream commands', () => {
	it('round-trips status, files, diff, totals, snapshot, and commit for a real workstream', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-1');
		const { invoke, db } = harness(dir);
		seed(db, 'ws-1', base, checkout);

		await writeFile(join(checkout, 'seed.txt'), 'seed\nedited\n');
		await writeFile(join(checkout, 'new.txt'), 'new\n');

		expect(await invoke('repositories.workstream-status', { workstreamId: 'ws-1' })).toEqual({
			branch: 'malini/ws-1',
			dirtyPaths: ['seed.txt', 'new.txt'],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: 0,
			behind: 0,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
			headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
		});
		expect(await invoke('repositories.workstream-files', { workstreamId: 'ws-1' })).toEqual([
			{ path: 'new.txt' },
			{ path: 'seed.txt' },
		]);
		const workingDiff = await invoke<string>('repositories.workstream-diff', {
			workstreamId: 'ws-1',
			path: null,
		});
		expect(workingDiff).toContain('+edited');
		expect(workingDiff).toContain('new.txt');
		const baseDiff = await invoke<string>('repositories.workstream-diff', {
			workstreamId: 'ws-1',
			path: 'seed.txt',
			baseBranch: 'main',
		});
		expect(baseDiff).toContain('+edited');
		expect(
			await invoke('repositories.workstream-change-totals', {
				workstreamId: 'ws-1',
				baseBranch: 'main',
			}),
		).toEqual({ additions: 2, deletions: 0, files: 2 });
		expect(
			await invoke('repositories.workstream-snapshot', {
				workstreamId: 'ws-1',
				baseBranch: 'main',
			}),
		).toEqual({ patch: baseDiff, totals: { additions: 2, deletions: 0, files: 2 } });

		const sha = await invoke<string>('repositories.commit-workstream', {
			workstreamId: 'ws-1',
			message: '  ',
		});
		expect((await realGit(checkout, ['log', '-1', '--format=%h %s'])).trim()).toBe(
			`${sha} Agent changes`,
		);
		await expect(
			invoke('repositories.commit-workstream', { workstreamId: 'ws-1', message: 'again' }),
		).rejects.toThrow('Nothing to commit - no repository changes.');
	});

	it('commits a run subject at most once, even after an Update branch merge lands on top', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, base, checkout } = await workstreamFixture(dir, 'ws-1');
		const { invoke, db } = harness(dir);
		seed(db, 'ws-1', base, checkout);
		const alpha = { id: 'run-alpha', messageIfAlreadyCommitted: 'Update workstream' };
		const headSubject = async (): Promise<string> =>
			(await realGit(checkout, ['log', '-1', '--format=%s'])).trim();

		await writeFile(join(checkout, 'alpha.txt'), 'alpha\n');
		await invoke('repositories.commit-workstream', {
			workstreamId: 'ws-1',
			message: 'feat: add alpha',
			run: alpha,
		});
		expect(await headSubject()).toBe('feat: add alpha');

		const upstream = join(dir, 'upstream');
		await realGit(dir, ['clone', '-q', remote, upstream]);
		await realGit(upstream, ['config', 'user.email', 't@example.com']);
		await realGit(upstream, ['config', 'user.name', 't']);
		await writeFile(join(upstream, 'upstream.txt'), 'upstream\n');
		await realGit(upstream, ['add', '.']);
		await realGit(upstream, ['commit', '-q', '-m', 'upstream']);
		await realGit(upstream, ['push', '-q', 'origin', 'main']);
		await invoke('repositories.pull-workstream', { workstreamId: 'ws-1', baseBranch: 'main' });
		expect((await realGit(checkout, ['log', '-1', '--format=%P'])).trim().split(' ')).toHaveLength(
			2,
		);

		await writeFile(join(checkout, 'beta.txt'), 'beta\n');
		await invoke('repositories.commit-workstream', {
			workstreamId: 'ws-1',
			message: 'feat: add alpha',
			run: alpha,
		});
		expect(await headSubject()).toBe('Update workstream');

		await writeFile(join(checkout, 'gamma.txt'), 'gamma\n');
		await invoke('repositories.commit-workstream', {
			workstreamId: 'ws-1',
			message: 'feat: add gamma',
			run: { id: 'run-gamma', messageIfAlreadyCommitted: 'Update workstream' },
		});
		expect(await headSubject()).toBe('feat: add gamma');
	});

	it('announces the conflicts a pull of the base branch stops on, and only those', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, base, checkout } = await workstreamFixture(dir, 'ws-1');
		const { invoke, events, db } = harness(dir);
		seed(db, 'ws-1', base, checkout);
		const conflicted: unknown[] = [];
		events.subscribe('repositories:workstream-merge-conflicted', (payload) =>
			conflicted.push(payload),
		);
		const upstream = join(dir, 'upstream');
		await realGit(dir, ['clone', '-q', remote, upstream]);
		await realGit(upstream, ['config', 'user.email', 't@example.com']);
		await realGit(upstream, ['config', 'user.name', 't']);
		const pushUpstream = async (file: string, text: string): Promise<void> => {
			await writeFile(join(upstream, file), text);
			await realGit(upstream, ['add', '.']);
			await realGit(upstream, ['commit', '-q', '-m', file]);
			await realGit(upstream, ['push', '-q', 'origin', 'main']);
		};

		await pushUpstream('upstream.txt', 'upstream\n');
		await invoke('repositories.pull-workstream', { workstreamId: 'ws-1', baseBranch: 'main' });
		expect(conflicted).toEqual([]);

		await writeFile(join(checkout, 'seed.txt'), 'ours\n');
		await realGit(checkout, ['commit', '-qam', 'ours']);
		await pushUpstream('seed.txt', 'theirs\n');
		await invoke('repositories.pull-workstream', { workstreamId: 'ws-1', baseBranch: 'main' });
		expect(conflicted).toEqual([
			{ workstreamId: 'ws-1', baseBranch: 'main', conflictedPaths: ['seed.txt'] },
		]);
	});

	it('creates a workstream from a base clone, emits worktree-added, then tears it down', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base } = await workstreamFixture(dir, 'ws-seed');
		const leases: string[] = [];
		const { invoke, events, db } = harness(dir, {
			guardRunLease: async (workstreamId, teardown) => {
				leases.push(workstreamId);
				return teardown();
			},
		});
		const added: WorktreeAddedPayload[] = [];
		const removed: unknown[] = [];
		events.subscribe('repositories:workstream-created', (payload) => {
			if (isWorktreeAddedPayload(payload)) added.push(payload);
		});
		events.subscribe('repositories:workstream-removed', (payload) => removed.push(payload));

		const path = await invoke<string>('repositories.create-workstream', {
			projectRepoPath: base,
			workstreamId: 'ws-new',
			baseBranch: 'main',
			projectId: 'proj',
			name: 'New work',
		});
		expect(path).toBe(join(dir, 'workstreams', 'ws-new'));
		expect(existsSync(join(path, 'seed.txt'))).toBe(true);
		expect((await realGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
			'malini/ws-new',
		);
		expect(getWorkstream(db, 'ws-new')).toMatchObject({
			id: 'ws-new',
			projectId: 'proj',
			name: 'New work',
			path,
			branch: 'malini/ws-new',
			baseBranch: 'main',
			status: 'active',
		});
		expect(added).toEqual([
			{
				workstreamId: 'ws-new',
				project: expect.objectContaining({ id: 'proj', repoPath: base, defaultBranch: 'main' }),
				workstream: expect.objectContaining({ id: 'ws-new' }),
			},
		]);
		const exclude = (
			await realGit(path, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])
		).trim();
		expect(existsSync(exclude)).toBe(true);

		await expect(
			invoke('repositories.create-workstream', {
				projectRepoPath: base,
				workstreamId: 'ws-new',
				baseBranch: 'main',
				projectId: 'proj',
				name: 'Again',
			}),
		).rejects.toThrow('branch already exists: malini/ws-new');

		const canonicalPath = await realpath(path);
		await invoke('repositories.delete-workstream', { workstreamId: 'ws-new' });
		expect(existsSync(path)).toBe(false);
		expect(getWorkstream(db, 'ws-new')).toBeNull();
		expect(leases).toEqual(['ws-new']);
		expect(removed).toEqual([
			{ workstreamId: 'ws-new', worktreePath: canonicalPath, deleted: true },
		]);
		await vi.waitFor(async () =>
			expect(await realGit(base, ['worktree', 'list', '--porcelain'])).not.toContain('ws-new'),
		);
		await vi.waitFor(async () =>
			expect((await realGit(base, ['branch', '--list', 'malini/ws-new'])).trim()).toBe(''),
		);
	});

	it('archives through the same teardown, then restores the checkout and announces it', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-arch');
		const canonical = await realpath(checkout);
		const { invoke, events, db } = harness(dir);
		seed(db, 'ws-arch', base, checkout);
		const removed: unknown[] = [];
		const added: WorktreeAddedPayload[] = [];
		events.subscribe('repositories:workstream-removed', (payload) => removed.push(payload));
		events.subscribe('repositories:workstream-created', (payload) => {
			if (isWorktreeAddedPayload(payload)) added.push(payload);
		});

		await invoke('repositories.archive-workstream', { workstreamId: 'ws-arch' });
		expect(existsSync(checkout)).toBe(false);
		expect(removed).toEqual([{ workstreamId: 'ws-arch', worktreePath: canonical, archived: true }]);
		expect(getWorkstream(db, 'ws-arch')?.status).toBe('archived');

		await archivedLeftoversCleared();
		await invoke('repositories.restore-workstream', { workstreamId: 'ws-arch' });
		expect(existsSync(join(checkout, 'seed.txt'))).toBe(true);
		expect(added).toEqual([
			{
				workstreamId: 'ws-arch',
				project: expect.objectContaining({ id: 'proj' }),
				workstream: expect.objectContaining({ id: 'ws-arch', status: 'active', path: checkout }),
			},
		]);
		await expect(
			invoke('repositories.restore-workstream', { workstreamId: 'ws-arch' }),
		).rejects.toThrow('Not an archived workstream: ws-arch');
	});

	it('saves a workstream for later through the archive teardown, moves it to the archive and restores it off the shelf', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-later');
		const canonical = await realpath(checkout);
		const { invoke, events, db } = harness(dir);
		seed(db, 'ws-later', base, checkout);
		await writeFile(join(checkout, 'seed.txt'), 'unsaved edit\n');
		const removed: unknown[] = [];
		events.subscribe('repositories:workstream-removed', (payload) => removed.push(payload));
		const savedForLater = async (): Promise<boolean | undefined> =>
			(
				await invoke<ArchivedWorkstreamDto[]>('repositories.list-archived-workstreams', undefined)
			).find(({ id }) => id === 'ws-later')?.savedForLater;

		await invoke('repositories.save-workstream-for-later', { workstreamId: 'ws-later' });
		expect(existsSync(checkout)).toBe(false);
		expect(removed).toEqual([
			{ workstreamId: 'ws-later', worktreePath: canonical, archived: true },
		]);
		expect(await savedForLater()).toBe(true);
		await expect(
			invoke('repositories.save-workstream-for-later', { workstreamId: 'ws-later' }),
		).rejects.toThrow('It is already archived');

		await invoke('repositories.archive-workstream', { workstreamId: 'ws-later' });
		expect(await savedForLater()).toBe(false);
		await invoke('repositories.save-workstream-for-later', { workstreamId: 'ws-later' });
		expect(await savedForLater()).toBe(true);
		expect(removed).toHaveLength(1);

		await archivedLeftoversCleared();
		await invoke('repositories.restore-workstream', { workstreamId: 'ws-later' });
		expect(await readFile(join(checkout, 'seed.txt'), 'utf8')).toBe('unsaved edit\n');
		expect(await savedForLater()).toBeUndefined();
	});

	it('brings back the ignored .context and the chat attachments when a workstream is restored', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-kept');
		const { invoke, db } = harness(dir);
		seed(db, 'ws-kept', base, checkout);
		await writeFile(join(base, '.git', 'info', 'exclude'), '*.png\n');
		await mkdir(join(checkout, '.context', 'review'), { recursive: true });
		await writeFile(join(checkout, '.context', 'review', 'shot.png'), 'shot\n');
		await writeFile(join(checkout, '.context', 'notes.md'), 'notes\n');
		await writeAttachmentFixture(checkout);

		await invoke('repositories.archive-workstream', { workstreamId: 'ws-kept' });
		await archivedLeftoversCleared();
		expect(existsSync(checkout)).toBe(false);
		await invoke('repositories.restore-workstream', { workstreamId: 'ws-kept' });

		expect(await readFile(join(checkout, '.context', 'review', 'shot.png'), 'utf8')).toBe('shot\n');
		expect(await readFile(join(checkout, '.context', 'notes.md'), 'utf8')).toBe('notes\n');
		expect(
			await readFile(join(checkout, AGENT_ATTACHMENTS_PATH, 'att-test', 'payload.txt'), 'utf8'),
		).toBe('private transport bytes\n');
		expect(existsSync(join(dir, 'workstreams', '.kept', 'ws-kept'))).toBe(false);
	});

	it('drops the folders an archived workstream kept once it is deleted', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-gone');
		const { invoke, db } = harness(dir);
		seed(db, 'ws-gone', base, checkout);
		await mkdir(join(checkout, '.context'), { recursive: true });
		await writeFile(join(base, '.git', 'info', 'exclude'), '.context/\n');
		await writeFile(join(checkout, '.context', 'shot.png'), 'shot\n');
		const kept = join(dir, 'workstreams', '.kept', 'ws-gone');

		await invoke('repositories.archive-workstream', { workstreamId: 'ws-gone' });
		expect(existsSync(join(kept, '.context', 'shot.png'))).toBe(true);
		await invoke('repositories.delete-workstream', { workstreamId: 'ws-gone' });
		await archivedLeftoversCleared();

		expect(existsSync(kept)).toBe(false);
	});

	it('refuses a teardown the run lease rejects before touching the disk', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-busy');
		const { invoke, db } = harness(dir, {
			guardRunLease: () => {
				throw Object.assign(new Error('work stream `ws-busy` has active agent runs'), {
					kind: 'workstream_teardown_blocked',
				});
			},
		});
		seed(db, 'ws-busy', base, checkout);
		await expect(
			invoke('repositories.delete-workstream', { workstreamId: 'ws-busy' }),
		).rejects.toThrow(/^An agent is still running in it, so nothing was removed$/);
		expect(existsSync(checkout)).toBe(true);
	});

	it('clones a repository, emits clone progress, and records the project row', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const source = join(dir, 'acme-source');
		await initRealRepo(source);
		const appData = join(dir, 'app-data');
		const { invoke, events, db } = harness(appData);
		const progress: unknown[] = [];
		events.subscribe('repositories:clone-progress', (payload) => progress.push(payload));

		const path = await invoke<string>('repositories.create-repository', {
			repoUrl: source,
		});
		expect(path).toBe(join(appData, 'repositories', 'acme-source', 'base'));
		expect(existsSync(join(path, 'seed.txt'))).toBe(true);
		expect(getProject(db, 'local__acme-source')).toMatchObject({
			name: 'acme-source',
			repoPath: path,
			defaultBranch: 'main',
		});
		expect(progress[0]).toEqual({ repo_id: 'acme-source', stage: 'fetch', fraction: 0.05 });
		expect(progress.at(-1)).toEqual({ repo_id: 'acme-source', stage: 'done', fraction: 1 });
	});

	it('rejects an unknown workstream, a bad id, and missing arguments with plain strings', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { commands } = harness(dir);
		expect(
			await commands.invoke({
				command: 'repositories.workstream-status',
				args: { workstreamId: 'ws-none' },
			}),
		).toEqual({ ok: false, error: 'Unknown workstream: ws-none' });
		expect(
			await commands.invoke({
				command: 'repositories.workstream-status',
				args: { workstreamId: '../x' },
			}),
		).toEqual({
			ok: false,
			error: 'unsafe path: workstream id contains unsafe char `.`: `../x`',
		});
		expect(await commands.invoke({ command: 'repositories.workstream-status', args: {} })).toEqual({
			ok: false,
			error: 'invalid args: `workstreamId` must be a string',
		});
		expect(
			await commands.invoke({
				command: 'repositories.workstream-snapshot',
				args: { workstreamId: 'ws-1', baseBranch: 'a..b' },
			}),
		).toEqual({ ok: false, error: 'unsafe path: invalid base branch `a..b`' });
	});

	it('hands the resolved checkout to the shell for reveal and editor', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-1');
		const canonical = await realpath(checkout);
		const opened: string[] = [];
		const shell: CheckoutShell = {
			reveal: async (path) => {
				opened.push(`reveal:${path}`);
			},
			openInEditor: async (path) => {
				opened.push(`edit:${path}`);
			},
		};
		const { invoke, db } = harness(dir, { shell });
		seed(db, 'ws-1', base, checkout);
		await invoke('repositories.reveal-workstream', { workstreamId: 'ws-1' });
		await invoke('repositories.open-workstream-in-editor', { workstreamId: 'ws-1' });
		expect(opened).toEqual([`reveal:${canonical}`, `edit:${canonical}`]);
	});
});

describe('removing a repository', () => {
	async function connectedSources(dir: string, deps: RepositoriesDeps = {}) {
		const app = harness(join(dir, 'app-data'), deps);
		const alpha = await sourceRepository(join(dir, 'alpha'));
		const beta = await sourceRepository(join(dir, 'beta'));
		const { repository: connected } = await app.invoke<RepositoryConnectionDto>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: alpha } },
		);
		const alphaBase = await app.invoke<string>('repositories.create-repository', {
			repoUrl: alpha,
		});
		const betaBase = await app.invoke<string>('repositories.create-repository', { repoUrl: beta });
		const workstream = (id: string, projectRepoPath: string, projectId: string) =>
			app.invoke<string>('repositories.create-workstream', {
				projectRepoPath,
				workstreamId: id,
				baseBranch: 'main',
				projectId,
				name: `Work ${id}`,
			});
		const edited = await workstream('ws-alpha-edited', alphaBase, 'local__alpha');
		const clean = await workstream('ws-alpha-clean', alphaBase, 'local__alpha');
		const other = await workstream('ws-beta', betaBase, 'local__beta');
		await writeFile(join(edited, 'seed.txt'), 'seed\nunsaved edit\n');
		await writeFile(join(edited, 'notes.txt'), 'notes\n');
		return { ...app, alpha, connected, alphaBase, betaBase, edited, clean, other };
	}

	it('deletes every workstream, archived ones too, keeping its work in a saved ref and the clone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const app = await connectedSources(dir);
		await app.invoke('repositories.archive-workstream', { workstreamId: 'ws-alpha-clean' });
		const removed: unknown[] = [];
		app.events.subscribe('repositories:workstream-removed', (payload) => removed.push(payload));

		await app.invoke('repositories.remove', { repoId: app.connected.id });

		expect(removed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ workstreamId: 'ws-alpha-edited', deleted: true }),
				expect.objectContaining({ workstreamId: 'ws-alpha-clean', deleted: true }),
			]),
		);
		expect(removed).toHaveLength(2);
		expect(listWorkstreams(app.db).map((row) => row.id)).toEqual(['ws-beta']);
		expect(listArchivedWorkstreams(app.db)).toEqual([]);
		expect(existsSync(app.edited)).toBe(false);
		expect(existsSync(app.other)).toBe(true);
		expect(listConnectedRepositories(app.db)).toEqual([]);
		expect(getProject(app.db, 'local__alpha')).toBeNull();
		expect(getProject(app.db, 'local__beta')).not.toBeNull();
		expect(existsSync(join(app.alphaBase, '.git'))).toBe(true);
		const saved = 'refs/malini/archived/ws-alpha-edited';
		expect(await realGit(app.alphaBase, ['show', `${saved}:seed.txt`])).toBe(
			'seed\nunsaved edit\n',
		);
		expect(await realGit(app.alphaBase, ['show', `${saved}:notes.txt`])).toBe('notes\n');

		const again = await app.invoke<RepositoryConnectionDto>('repositories.connect', {
			source: { kind: 'local-folder', path: app.alpha },
		});
		expect(again).toMatchObject({ repository: { fullName: 'alpha' }, created: true });
		expect(await app.invoke('repositories.create-repository', { repoUrl: app.alpha })).toBe(
			app.alphaBase,
		);
		expect(
			(await realGit(app.alphaBase, ['for-each-ref', '--format=%(refname)', saved])).trim(),
		).toBe(saved);
	});

	it('keeps the repository and every workstream when an archive fails', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const app = await connectedSources(dir, {
			guardRunLease: () => {
				throw Object.assign(new Error('work stream has active agent runs'), {
					kind: 'workstream_teardown_blocked',
				});
			},
		});

		await expect(app.invoke('repositories.remove', { repoId: app.connected.id })).rejects.toThrow(
			/^Work ws-alpha-(edited|clean): An agent is still running in it, so nothing was removed$/u,
		);

		expect(
			listWorkstreams(app.db)
				.map((row) => row.id)
				.sort(),
		).toEqual(['ws-alpha-clean', 'ws-alpha-edited', 'ws-beta']);
		expect(existsSync(app.edited)).toBe(true);
		expect(await readFile(join(app.edited, 'seed.txt'), 'utf8')).toBe('seed\nunsaved edit\n');
		expect(listConnectedRepositories(app.db).map((row) => row.id)).toEqual([app.connected.id]);
		expect(getProject(app.db, 'local__alpha')).not.toBeNull();
	});

	it('removes a repository the sidebar only knows from its workstreams', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const app = await connectedSources(dir);

		await app.invoke('repositories.remove', { repoId: 'local:local__beta' });

		expect(
			listWorkstreams(app.db)
				.map((row) => row.id)
				.sort(),
		).toEqual(['ws-alpha-clean', 'ws-alpha-edited']);
		expect(getProject(app.db, 'local__beta')).toBeNull();
		expect(existsSync(join(app.betaBase, '.git'))).toBe(true);
		expect(listConnectedRepositories(app.db).map((row) => row.id)).toEqual([app.connected.id]);
		await expect(
			app.invoke('repositories.remove', { repoId: 'local:local__beta' }),
		).rejects.toThrow('Unknown repository: local:local__beta');
	});

	it('hides a repository without touching its workstreams, and forgets it on remove', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const app = await connectedSources(dir);
		const workstreamIds = listWorkstreams(app.db).map((row) => row.id);

		await app.invoke('repositories.set-hidden', { repoId: app.connected.id, hidden: true });
		await app.invoke('repositories.set-hidden', { repoId: app.connected.id, hidden: true });
		await app.invoke('repositories.set-hidden', { repoId: 'local:local__beta', hidden: true });
		await app.invoke('repositories.set-hidden', { repoId: 'local:local__beta', hidden: false });

		expect(await app.invoke('repositories.list-hidden', undefined)).toEqual([app.connected.id]);
		expect(listWorkstreams(app.db).map((row) => row.id)).toEqual(workstreamIds);
		await expect(
			app.invoke('repositories.set-hidden', { repoId: app.connected.id, hidden: 'yes' }),
		).rejects.toThrow('`hidden` must be a boolean');

		await app.invoke('repositories.remove', { repoId: app.connected.id });

		expect(await app.invoke('repositories.list-hidden', undefined)).toEqual([]);
	});
});

async function sourceRepository(path: string): Promise<string> {
	await initRealRepo(path);
	await realGit(path, ['branch', '-M', 'main']);
	return path;
}

describe('reading a workstream while its files change', () => {
	it('serves the snapshot through a file deleted mid-read, recording no error', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-undo');
		const { commands, db, invoke } = harness(dir);
		const diagnostics = new MainDiagnosticsLog({
			appDataRoot: dir,
			runtime: { productName: 'Malini', bundleIdentifier: 'test', version: '0.0.0', pid: 1 },
		});
		commands.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		seed(db, 'ws-undo', base, checkout);
		const undone = join(checkout, 'undone.txt');
		await realGit(checkout, ['config', 'filter.undo.clean', `sh -c 'rm -f "${undone}"; cat'`]);
		await writeFile(join(checkout, '.gitattributes'), 'agent.txt filter=undo\n');
		await writeFile(join(checkout, 'agent.txt'), 'kept\n');
		await writeFile(undone, 'rewound by undo while malini reads\n');
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		cleanups.push(async () => errors.mockRestore());

		const snapshot = await invoke<{ patch: string }>('repositories.workstream-snapshot', {
			workstreamId: 'ws-undo',
			baseBranch: 'main',
		});

		expect(existsSync(undone)).toBe(false);
		expect(snapshot.patch).toContain('agent.txt');
		expect(snapshot.patch).not.toContain('undone.txt');
		expect(existsSync(currentLogPath(diagnosticsDirectory(dir), 'main'))).toBe(false);
		expect(errors).not.toHaveBeenCalled();
	});

	it('records a read that loses its checkout to an archive as a warning, and a later read as an error', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-gone');
		const snapshot = {
			command: 'repositories.workstream-snapshot',
			args: { workstreamId: 'ws-gone', baseBranch: 'main' },
		};
		const reads: InvokeResponse[] = [];
		let readMidTeardown = async (): Promise<void> => {};
		const { commands, db, invoke } = harness(dir, {
			guardRunLease: async (_workstreamId, teardown) => {
				const retired = await teardown();
				await readMidTeardown();
				return retired;
			},
		});
		readMidTeardown = async () => {
			reads.push(await commands.invoke(snapshot));
		};
		const diagnostics = new MainDiagnosticsLog({
			appDataRoot: dir,
			runtime: { productName: 'Malini', bundleIdentifier: 'test', version: '0.0.0', pid: 1 },
		});
		commands.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		seed(db, 'ws-gone', base, checkout);

		await invoke('repositories.archive-workstream', { workstreamId: 'ws-gone' });
		reads.push(await commands.invoke(snapshot));

		expect(reads.map((read) => read.ok)).toEqual([false, false]);
		const recorded = (await readFile(currentLogPath(diagnosticsDirectory(dir), 'main'), 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { level: string; command: string });
		expect(recorded.map(({ level, command }) => [level, command])).toEqual([
			['warn', 'repositories.workstream-snapshot'],
			['error', 'repositories.workstream-snapshot'],
		]);
	});
});

describe('following your own pull requests from another Mac', () => {
	it('opens new pull request branches as workstreams, fast-forwards known ones, and skips deleted ones and hidden repositories', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { remote, base, checkout } = await workstreamFixture(dir, 'ws-here');
		await realGit(checkout, ['push', '-q', 'origin', 'malini/ws-here']);
		const laptop = join(dir, 'laptop');
		await realGit(dir, ['clone', '-q', remote, laptop]);
		await realGit(laptop, ['config', 'user.email', 't@example.com']);
		await realGit(laptop, ['config', 'user.name', 't']);
		const pushFromLaptop = async (branch: string, start: string, file: string): Promise<string> => {
			await realGit(laptop, ['checkout', '-q', '-B', branch, start]);
			await writeFile(join(laptop, file), `${file}\n`);
			await realGit(laptop, ['add', file]);
			await realGit(laptop, ['commit', '-qm', `Add ${file}`]);
			await realGit(laptop, ['push', '-q', 'origin', branch]);
			return (await realGit(laptop, ['rev-parse', 'HEAD'])).trim();
		};
		const hereHead = await pushFromLaptop('malini/ws-here', 'origin/malini/ws-here', 'here.txt');
		const laptopHead = await pushFromLaptop('malini/ws-laptop', 'origin/main', 'laptop.txt');
		const goneHead = await pushFromLaptop('malini/ws-gone', 'origin/main', 'gone.txt');
		const featureHead = await pushFromLaptop('feature/x', 'origin/main', 'feature.txt');
		const listed = [
			{
				title: 'feat(sync)!: laptop work, carried over',
				headRefName: 'malini/ws-laptop',
				headRefOid: laptopHead,
			},
			{ title: 'Here work', headRefName: 'malini/ws-here', headRefOid: hereHead },
			{ title: 'Deleted work', headRefName: 'malini/ws-gone', headRefOid: goneHead },
			{ title: 'feat: flag every feature', headRefName: 'feature/x', headRefOid: featureHead },
			{ title: 'Default branch', headRefName: 'main', headRefOid: hereHead },
			{ title: 'Fork', headRefName: 'malini/ws-fork', headRefOid: goneHead, fork: true },
		].map(({ fork, ...pullRequest }) => ({
			...pullRequest,
			baseRefName: 'main',
			isCrossRepository: fork === true,
		}));
		const { invoke, db } = harness(dir, {
			ghRunner: async () => ({ stdout: JSON.stringify(listed), stderr: '', code: 0 }),
			nameWorkstream: async (task) => {
				if (task === 'feat: flag every feature') return 'Feature flags';
				throw new Error('Claude is signed out');
			},
		});
		seed(db, 'ws-here', base, checkout);
		seed(db, 'ws-gone', base, join(dir, 'workstreams', 'ws-gone'));
		deleteWorkstream(db, 'ws-gone');

		await invoke('repositories.set-hidden', { repoId: 'local:proj', hidden: true });
		expect(await invoke('repositories.sync-own-pull-requests', undefined)).toEqual([]);
		expect(getWorkstream(db, 'ws-laptop')).toBeNull();
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).not.toBe(hereHead);

		await invoke('repositories.set-hidden', { repoId: 'local:proj', hidden: false });
		const adoptedIds = await invoke<string[]>('repositories.sync-own-pull-requests', undefined);
		const feature = listWorkstreams(db).find(({ branch }) => branch === 'feature/x');
		expect(adoptedIds).toEqual(['ws-laptop', feature?.id]);
		expect(feature).toMatchObject({ name: 'Feature flags', baseBranch: 'main', status: 'active' });
		expect(listWorkstreams(db).filter(({ branch }) => branch === 'main')).toEqual([]);
		expect(getWorkstream(db, 'ws-laptop')).toMatchObject({
			name: 'Laptop work, carried over',
			branch: 'malini/ws-laptop',
			baseBranch: 'main',
			status: 'active',
		});
		const adopted = join(dir, 'workstreams', 'ws-laptop');
		expect((await realGit(adopted, ['rev-parse', 'HEAD'])).trim()).toBe(laptopHead);
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(hereHead);
		expect(getWorkstream(db, 'ws-gone')).toBeNull();
		expect(getWorkstream(db, 'ws-fork')).toBeNull();
		expect(await invoke('repositories.sync-own-pull-requests', undefined)).toEqual([]);

		const featureId = feature?.id ?? '';
		const featureCheckout = join(dir, 'workstreams', featureId);
		expect((await realGit(featureCheckout, ['rev-parse', 'HEAD'])).trim()).toBe(featureHead);
		await writeFile(join(featureCheckout, 'more.txt'), 'more\n');
		await invoke('repositories.commit-workstream', {
			workstreamId: featureId,
			message: 'Flag more features',
		});
		expect((await realGit(featureCheckout, ['branch', '--show-current'])).trim()).toBe('feature/x');
		await invoke('repositories.delete-workstream', { workstreamId: featureId });
		expect(await invoke('repositories.sync-own-pull-requests', undefined)).toEqual([]);
		expect(listWorkstreams(db).filter(({ branch }) => branch === 'feature/x')).toEqual([]);
	});
});
