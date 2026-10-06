import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './db/open';
import { all, run } from './db/rows';
import { adoptLegacyAppData } from './legacy-app-data';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function smackProfile(): { legacy: string; current: string } {
	const parent = mkdtempSync(join(tmpdir(), 'malini-app-data-'));
	roots.push(parent);
	const legacy = join(parent, 'smack');
	const current = join(parent, 'malini');
	const worktree = join(legacy, 'workstreams', 'ws-1');
	const adminDir = join(legacy, 'repositories', 'acme__app', 'base', '.git', 'worktrees', 'ws-1');
	mkdirSync(worktree, { recursive: true });
	mkdirSync(adminDir, { recursive: true });
	mkdirSync(current);
	mkdirSync(join(legacy, 'provider-auth'));
	writeFileSync(join(legacy, 'provider-auth', 'deepseek-api-key-v1.bin'), 'sealed by smack');
	writeFileSync(join(worktree, '.git'), `gitdir: ${adminDir}\n`);
	writeFileSync(join(adminDir, 'gitdir'), `${join(worktree, '.git')}\n`);
	const db = openMigratedDatabase(join(legacy, 'smack.sqlite'));
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'app', ?, 'main', 'now')`,
		join(legacy, 'repositories', 'acme__app', 'base'),
	);
	run(
		db,
		`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('ws-1', 'p', 'ws', ?, 'smack/ws-1', 'main', 'active', 'now')`,
		worktree,
	);
	db.close();
	return { legacy, current };
}

describe('adoptLegacyAppData', () => {
	it('moves the smack folder to malini and repoints its paths and worktrees', () => {
		const { legacy, current } = smackProfile();

		expect(adoptLegacyAppData(current)).toBeNull();

		expect(existsSync(legacy)).toBe(false);
		expect(existsSync(join(current, 'smack.sqlite'))).toBe(false);
		const db = openMigratedDatabase(join(current, 'malini.sqlite'));
		expect(all<{ repo_path: string }>(db, 'SELECT repo_path FROM projects')).toEqual([
			{ repo_path: join(current, 'repositories', 'acme__app', 'base') },
		]);
		expect(
			all<{ path: string; branch: string }>(db, 'SELECT path, branch FROM workstreams'),
		).toEqual([{ path: join(current, 'workstreams', 'ws-1'), branch: 'smack/ws-1' }]);
		db.close();
		const adminDir = join(
			current,
			'repositories',
			'acme__app',
			'base',
			'.git',
			'worktrees',
			'ws-1',
		);
		expect(readFileSync(join(current, 'workstreams', 'ws-1', '.git'), 'utf8')).toBe(
			`gitdir: ${adminDir}\n`,
		);
		expect(readFileSync(join(adminDir, 'gitdir'), 'utf8')).toBe(
			`${join(current, 'workstreams', 'ws-1', '.git')}\n`,
		);
		expect(existsSync(join(current, 'provider-auth', 'deepseek-api-key-v1.bin'))).toBe(true);
	});

	it('leaves both folders alone once malini has data of its own', () => {
		const { legacy, current } = smackProfile();
		writeFileSync(join(current, 'malini.sqlite'), '');

		expect(adoptLegacyAppData(current)).toBeNull();

		expect(existsSync(join(legacy, 'smack.sqlite'))).toBe(true);
	});

	it('asks to quit smack while it still runs', () => {
		const { legacy, current } = smackProfile();
		symlinkSync(`host-${process.pid}`, join(legacy, 'SingletonLock'));

		expect(adoptLegacyAppData(current)).toMatch(/Quit smack/u);

		expect(existsSync(join(legacy, 'smack.sqlite'))).toBe(true);
	});
});
