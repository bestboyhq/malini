import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '$main/db/driver';
import { run } from '$main/db/rows';
import { readTrimmedOutput } from './trimmed-output';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('readTrimmedOutput', () => {
	it('counts what RTK trimmed per program, as its own headline does', () => {
		const path = historyWith([
			['grep -rn needle src', 400, 100, 300],
			['grep needle notes.txt', 200, 150, 50],
			['ls -la', 100, 120, -20],
			['git status', 90_000, 1_000, 89_000],
			['make', 50, 10, 40],
		]);

		expect(readTrimmedOutput(path)).toEqual({
			commands: 4,
			inputTokens: 750,
			savedTokens: 390,
			programs: [
				{ program: 'grep', commands: 2, inputTokens: 600, savedTokens: 350 },
				{ program: 'make', commands: 1, inputTokens: 50, savedTokens: 40 },
				{ program: 'ls', commands: 1, inputTokens: 100, savedTokens: 0 },
			],
		});
	});

	it('has nothing to show before RTK counts a command', () => {
		expect(readTrimmedOutput(join(tmpdir(), 'malini-no-such-rtk', 'history.db'))).toBeNull();
		expect(readTrimmedOutput(historyWith([]))).toBeNull();
	});
});

function historyWith(rows: readonly (readonly [string, number, number, number])[]): string {
	const folder = mkdtempSync(join(tmpdir(), 'malini-rtk-test-'));
	folders.push(folder);
	const path = join(folder, 'history.db');
	const db = openDatabase(path);
	db.exec(`CREATE TABLE commands (
		id INTEGER PRIMARY KEY,
		timestamp TEXT NOT NULL,
		original_cmd TEXT NOT NULL,
		rtk_cmd TEXT NOT NULL,
		input_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL,
		saved_tokens INTEGER NOT NULL,
		savings_pct REAL NOT NULL,
		exec_time_ms INTEGER DEFAULT 0,
		project_path TEXT DEFAULT ''
	)`);
	for (const [command, input, output, saved] of rows) {
		run(
			db,
			`INSERT INTO commands (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct)
			 VALUES ('2026-11-20T10:00:00Z', ?, ?, ?, ?, ?, 0)`,
			command,
			`rtk ${command}`,
			input,
			output,
			saved,
		);
	}
	db.close();
	return path;
}
