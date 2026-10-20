import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './driver';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('openDatabase', () => {
	it('round-trips rows through a prepared statement', () => {
		const db = openDatabase(':memory:');
		db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
		db.prepare('INSERT INTO notes (body) VALUES (?)').run('hello');
		expect(db.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'hello' }]);
		expect(db.sqliteVersion()).toMatch(/^\d+\.\d+\.\d+$/);
		db.close();
	});

	it('rolls a failed transaction back completely', () => {
		const db = openDatabase(':memory:');
		db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL UNIQUE)');
		expect(() =>
			db.transaction(() => {
				db.prepare('INSERT INTO notes (body) VALUES (?)').run('once');
				db.prepare('INSERT INTO notes (body) VALUES (?)').run('once');
			}),
		).toThrow();
		expect(db.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 0 });
		db.close();
	});

	it('persists to disk in WAL mode and survives reopen', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'malini-db-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const path = join(dir, 'malini.sqlite');

		const first = openDatabase(path);
		expect(first.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
		first.exec('CREATE TABLE notes (body TEXT)');
		first.prepare('INSERT INTO notes VALUES (?)').run('kept');
		first.close();

		const second = openDatabase(path);
		expect(second.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'kept' }]);
		second.close();
	});
});
