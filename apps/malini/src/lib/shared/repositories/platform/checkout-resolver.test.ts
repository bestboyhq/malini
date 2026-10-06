import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { WORKSTREAM_FOLDER_MISSING } from '$main/errors';
import {
	UNKNOWN_WORKSTREAM,
	UNKNOWN_WORKSTREAM_REPOSITORY,
	createCheckoutResolver,
	type CheckoutResolver,
} from './checkout-resolver';
import { upsertProject } from './projects.repository';
import { upsertWorkstream } from './workstreams.repository';

const execFileAsync = promisify(execFile);

let root: string;
let db: MaliniDatabase;
let resolver: CheckoutResolver;

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

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-checkouts-')));
	db = openMigratedDatabase(':memory:');
	resolver = createCheckoutResolver({ db, appDataRoot: root });
});

afterEach(() => {
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('the one checkout resolver', () => {
	it('answers the canonical checkout and the owning repository root', async () => {
		const base = join(root, 'repositories', 'p1', 'base');
		await initRepo(base);
		seedProject('p1', base);
		const checkout = join(root, 'workstreams', 'ws-1');
		await git(base, ['worktree', 'add', '-q', checkout, '-b', 'malini/ws-1']);
		seedWorkstream('ws-1', 'p1', checkout);

		expect(await resolver.resolveCheckout('ws-1')).toBe(checkout);
		expect(await resolver.resolveRepositoryRoot('ws-1')).toBe(base);
	});

	it('names the workstream it cannot find', async () => {
		await expect(resolver.resolveCheckout('missing')).rejects.toThrow(
			`${UNKNOWN_WORKSTREAM}: missing`,
		);
		await expect(resolver.resolveRepositoryRoot('missing')).rejects.toThrow(
			`${UNKNOWN_WORKSTREAM}: missing`,
		);
	});

	it('names the repository row a workstream points at but that is gone', async () => {
		const base = join(root, 'repositories', 'p1', 'base');
		await initRepo(base);
		seedProject('p-missing', base);
		seedWorkstream('ws-orphan', 'p-missing', join(root, 'workstreams', 'ws-orphan'));
		db.exec('PRAGMA foreign_keys = OFF');
		db.exec("DELETE FROM projects WHERE id = 'p-missing'");
		db.exec('PRAGMA foreign_keys = ON');

		await expect(resolver.resolveRepositoryRoot('ws-orphan')).rejects.toThrow(
			`${UNKNOWN_WORKSTREAM_REPOSITORY}: p-missing`,
		);
	});

	it('reports a checkout that is recorded but not on disk', async () => {
		seedProject('p1', join(root, 'repositories', 'p1', 'base'));
		seedWorkstream('ws-gone', 'p1', join(root, 'workstreams', 'ws-gone'));
		await expect(resolver.resolveCheckout('ws-gone')).rejects.toThrow(WORKSTREAM_FOLDER_MISSING);
	});

	it('refuses a recorded path outside the app checkout roots', async () => {
		const outside = join(root, 'elsewhere');
		mkdirSync(outside, { recursive: true });
		seedProject('p1', outside);
		seedWorkstream('ws-out', 'p1', outside);
		await expect(resolver.resolveCheckout('ws-out')).rejects.toThrow(WORKSTREAM_FOLDER_MISSING);
	});
});
