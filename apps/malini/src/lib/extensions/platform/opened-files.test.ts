import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileOpenRequestedPayload } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import { createEventBus, type EventBus } from '$main/events';
import { openFileForUser, readOpenedFile, statOpenedFile, writeOpenedFile } from './opened-files';

let root: string;
let worktree: string;
let db: MaliniDatabase;
let events: EventBus;
let opened: FileOpenRequestedPayload[];
const home = process.env['HOME'];

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), 'malini-opened-files-')));
	worktree = join(root, 'worktree');
	await mkdir(join(worktree, '.git'), { recursive: true });
	await writeFile(join(worktree, 'notes.md'), 'plan\n');
	db = openMigratedDatabase(':memory:');
	seedWorkstream(db, 'ws-1');
	seedWorkstream(db, 'ws-2');
	events = createEventBus({ forwardToWindows: false });
	opened = [];
	events.subscribe('extensions:file-open-requested', (payload) => opened.push(payload));
});

afterEach(async () => {
	process.env['HOME'] = home;
	db.close();
	await rm(root, { recursive: true, force: true });
});

function open(path: string, line: number | null = null, keys: readonly string[] = []) {
	return openFileForUser({ db, events }, { workstreamId: 'ws-1', worktree, path, line, keys });
}

function grants(): unknown[] {
	return all(db, 'SELECT workstream_id, path FROM workstream_opened_files ORDER BY path');
}

async function mode(path: string): Promise<number> {
	return (await stat(path)).mode & 0o777;
}

describe('opening a file for the user', () => {
	it('opens a worktree file by its path in the worktree, at the line asked for, with no grant', async () => {
		expect(await open('notes.md', 4)).toEqual({ path: 'notes.md', created: false });
		expect(await open(join(worktree, 'notes.md'))).toEqual({ path: 'notes.md', created: false });

		expect(opened).toEqual([
			{ workstreamId: 'ws-1', path: 'notes.md', line: 4 },
			{ workstreamId: 'ws-1', path: 'notes.md', line: null },
		]);
		expect(grants()).toEqual([]);
	});

	it('creates a missing file outside the worktree private to the user and grants only its workstream', async () => {
		const secrets = join(root, 'home', '.secrets', 'malini.keys');

		expect(await open(secrets)).toEqual({ path: secrets, created: true });

		expect(await mode(secrets)).toBe(0o600);
		expect(await mode(join(root, 'home', '.secrets'))).toBe(0o700);
		expect(grants()).toEqual([{ workstream_id: 'ws-1', path: secrets }]);
		expect(opened).toEqual([{ workstreamId: 'ws-1', path: secrets, line: null }]);
		expect(await readOpenedFile(db, 'ws-1', secrets)).toBe('');
		await expect(readOpenedFile(db, 'ws-2', secrets)).rejects.toThrow('was not opened in it');
	});

	it('reads, saves and stats a granted file, keeping its mode', async () => {
		const secrets = join(root, 'malini.keys');
		await writeFile(secrets, 'TOKEN=old\n', { mode: 0o600 });
		expect(await open(secrets)).toEqual({ path: secrets, created: false });

		expect(await readOpenedFile(db, 'ws-1', secrets)).toBe('TOKEN=old\n');
		await writeOpenedFile(db, 'ws-1', secrets, 'TOKEN=new\n');

		expect(await readFile(secrets, 'utf8')).toBe('TOKEN=new\n');
		expect(await mode(secrets)).toBe(0o600);
		expect(await statOpenedFile(db, 'ws-1', secrets)).toEqual({ kind: 'file', size: 10 });
	});

	it('adds a blank line for each key the file does not set yet, keeping what it holds and its mode', async () => {
		const created = join(root, 'new.keys');
		expect(await open(created, null, ['API_TOKEN', 'API_TOKEN', 'REGION'])).toEqual({
			path: created,
			created: true,
		});
		expect(await readFile(created, 'utf8')).toBe('API_TOKEN=\nREGION=\n');
		expect(await mode(created)).toBe(0o600);

		const secrets = join(root, 'malini.keys');
		await writeFile(secrets, '# kennel\nexport API_TOKEN = "a\nb"\n  REGION=eu', { mode: 0o600 });
		await open(secrets, null, ['API_TOKEN', 'WEBHOOK_SECRET', 'REGION', 'kennel']);

		expect(await readFile(secrets, 'utf8')).toBe(
			'# kennel\nexport API_TOKEN = "a\nb"\n  REGION=eu\nWEBHOOK_SECRET=\nkennel=\n',
		);
		expect(await mode(secrets)).toBe(0o600);
	});

	it('refuses a key that is not a plain name before it creates or changes anything', async () => {
		const secrets = join(root, 'refused.keys');

		await expect(open(secrets, null, ['A=1\nB'])).rejects.toThrow('is not a key name');
		await expect(open(secrets, null, [''])).rejects.toThrow('is not a key name');
		await expect(stat(secrets)).rejects.toThrow();
		expect(opened).toEqual([]);
	});

	it('refuses to read, save or stat a path outside the worktree no agent opened', async () => {
		const elsewhere = join(root, 'elsewhere.txt');
		await writeFile(elsewhere, 'private\n');

		await expect(readOpenedFile(db, 'ws-1', elsewhere)).rejects.toThrow('was not opened in it');
		await expect(writeOpenedFile(db, 'ws-1', elsewhere, 'x')).rejects.toThrow(
			'was not opened in it',
		);
		await expect(statOpenedFile(db, 'ws-1', elsewhere)).rejects.toThrow('was not opened in it');
		expect(await readFile(elsewhere, 'utf8')).toBe('private\n');
	});

	it('follows a symlink to the file it names and saves through it, leaving the link in place', async () => {
		const target = join(root, 'vault', 'malini.keys');
		await mkdir(join(root, 'vault'));
		await writeFile(target, 'A=1\n');
		const link = join(root, 'linked.keys');
		await symlink(target, link);

		expect(await open(link)).toEqual({ path: target, created: false });
		await writeOpenedFile(db, 'ws-1', target, 'A=2\n');

		expect(await readFile(target, 'utf8')).toBe('A=2\n');
		expect((await lstat(link)).isSymbolicLink()).toBe(true);
	});

	it('reads ~/ as the home folder and a path that leaves the worktree as outside it', async () => {
		process.env['HOME'] = join(root, 'home');
		await mkdir(join(root, 'home'));

		expect(await open('~/.secrets/app.keys')).toEqual({
			path: join(root, 'home', '.secrets', 'app.keys'),
			created: true,
		});
		expect(await open('../sibling.txt')).toEqual({
			path: join(root, 'sibling.txt'),
			created: true,
		});
		await expect(open('~someone/file')).rejects.toThrow('as an absolute path or one under ~/');
	});

	it('never opens a folder, a file inside .git or an empty path, and creates nothing for them', async () => {
		await expect(open('.git/config')).rejects.toThrow('does not open files inside .git');
		await expect(open(root)).rejects.toThrow('is not a file');
		await expect(open(' ')).rejects.toThrow('Name the file to open');
		await expect(stat(join(worktree, '.git', 'config'))).rejects.toThrow();
		expect(opened).toEqual([]);
		expect(grants()).toEqual([]);
	});
});
