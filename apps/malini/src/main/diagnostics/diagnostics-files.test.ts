import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	currentLogPath,
	diagnosticsDirectory,
	readDiagnostics,
	rotatedLogPath,
} from './diagnostics-files';

const execFileAsync = promisify(execFile);
const CLI = resolve(__dirname, '../../../scripts/diagnostics.mjs');
const NODE_FLAGS = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'];

let root: string;
let directory: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'malini-diagnostics-files-'));
	directory = diagnosticsDirectory(root);
	mkdirSync(directory, { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function ndjson(...records: unknown[]): string {
	return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

function mainRecord(occurredAt: string, extra: Record<string, unknown> = {}): unknown {
	return {
		schemaVersion: 1,
		occurredAt,
		level: 'error',
		source: 'ipc-command',
		message: 'io error: EACCES: permission denied',
		command: 'repositories.archive-workstream',
		workstreamId: 'ws-1',
		durationMs: 12,
		error: { name: 'GitError', code: 'EACCES', kind: 'io', message: 'x', stack: null },
		runtime: { pid: 1 },
		...extra,
	};
}

function seedLogs(): void {
	writeFileSync(
		rotatedLogPath(directory, 'main', 1),
		ndjson(mainRecord('2026-09-23T08:00:00.000Z', { message: 'oldest, from the rotated file' })),
	);
	writeFileSync(
		currentLogPath(directory, 'main'),
		ndjson(
			mainRecord('2026-09-23T08:00:02.000Z'),
			mainRecord('2026-09-23T08:00:04.000Z', {
				level: 'warn',
				source: 'console',
				message: 'malini: base sync skipped',
				command: null,
				workstreamId: null,
				durationMs: null,
				error: null,
			}),
		) + 'not json at all\n',
	);
	writeFileSync(
		currentLogPath(directory, 'renderer-errors'),
		ndjson(
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:01.000Z',
				persistedAt: '2026-09-23T08:00:01.000Z',
				source: 'caught',
				route: '/workstreams/ws-2',
				error: { name: 'TypeError', message: 'x is undefined', stack: null },
			},
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:03.000Z',
				persistedAt: '2026-09-23T08:00:03.000Z',
				level: 'info',
				source: 'toast',
				toastLevel: 'success',
				route: '/',
				message: 'Committed',
			},
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:03.500Z',
				persistedAt: '2026-09-23T08:00:03.500Z',
				level: 'error',
				source: 'toast',
				toastLevel: 'error',
				route: '/workstreams/ws-2',
				workstreamId: 'ws-3',
				message: 'Could not archive Neon Circuit · It is in use, so nothing was removed.',
			},
		),
	);
}

describe('reading the diagnostics logs', () => {
	it('merges the main and renderer logs, rotated files included, oldest first', () => {
		seedLogs();

		const entries = readDiagnostics(root);

		expect(
			entries.map((entry) => [entry.occurredAt, entry.process, entry.level, entry.source]),
		).toEqual([
			['2026-09-23T08:00:00.000Z', 'main', 'error', 'ipc-command'],
			['2026-09-23T08:00:01.000Z', 'renderer', 'error', 'caught'],
			['2026-09-23T08:00:02.000Z', 'main', 'error', 'ipc-command'],
			['2026-09-23T08:00:03.000Z', 'renderer', 'info', 'toast'],
			['2026-09-23T08:00:03.500Z', 'renderer', 'error', 'toast'],
			['2026-09-23T08:00:04.000Z', 'main', 'warn', 'console'],
		]);
		expect(entries[1]).toMatchObject({
			errorName: 'TypeError',
			workstreamId: null,
			viewing: 'ws-2',
		});
		expect(entries[2]).toMatchObject({
			errorName: 'GitError',
			code: 'EACCES',
			command: 'repositories.archive-workstream',
			durationMs: 12,
			workstreamId: 'ws-1',
			viewing: null,
		});
		expect(entries[4]).toMatchObject({ workstreamId: 'ws-3', viewing: 'ws-2' });
	});

	it('filters by time and level, and keeps the newest when limited', () => {
		seedLogs();

		expect(
			readDiagnostics(root, { since: new Date('2026-09-23T08:00:02.000Z') }).map(
				(entry) => entry.occurredAt,
			),
		).toEqual([
			'2026-09-23T08:00:02.000Z',
			'2026-09-23T08:00:03.000Z',
			'2026-09-23T08:00:03.500Z',
			'2026-09-23T08:00:04.000Z',
		]);
		expect(readDiagnostics(root, { minimumLevel: 'warn' }).map((entry) => entry.source)).toEqual([
			'ipc-command',
			'caught',
			'ipc-command',
			'toast',
			'console',
		]);
		expect(readDiagnostics(root, { minimumLevel: 'error', limit: 1 })).toEqual([
			expect.objectContaining({ occurredAt: '2026-09-23T08:00:03.500Z' }),
		]);
	});

	it('answers nothing for a profile that never wrote diagnostics', () => {
		expect(readDiagnostics(join(root, 'elsewhere'))).toEqual([]);
	});
});

describe('the diagnostics command line', () => {
	it('prints one line per entry with time, process, level, source, message, the workstream it is about and the one on screen', async () => {
		seedLogs();

		const { stdout } = await execFileAsync(process.execPath, [...NODE_FLAGS, CLI, '--dir', root]);

		expect(stdout.trim().split('\n')).toEqual([
			'2026-09-23T08:00:00.000Z  main     error  ipc-command repositories.archive-workstream (12ms)  GitError [EACCES]: oldest, from the rotated file  workstream=ws-1',
			'2026-09-23T08:00:01.000Z  renderer error  caught  TypeError: x is undefined  viewing=ws-2',
			'2026-09-23T08:00:02.000Z  main     error  ipc-command repositories.archive-workstream (12ms)  GitError [EACCES]: io error: EACCES: permission denied  workstream=ws-1',
			'2026-09-23T08:00:03.000Z  renderer info   toast  Committed',
			'2026-09-23T08:00:03.500Z  renderer error  toast  Could not archive Neon Circuit · It is in use, so nothing was removed.  workstream=ws-3  viewing=ws-2',
			'2026-09-23T08:00:04.000Z  main     warn   console  malini: base sync skipped',
		]);
	});

	it('prints the cause on indented lines under its entry and how many repeats were left out', async () => {
		writeFileSync(
			currentLogPath(directory, 'main'),
			ndjson(
				mainRecord('2026-09-23T08:00:00.000Z', {
					level: 'warn',
					command: 'pull-requests.status',
					message: 'not logged in to github.com',
					suppressedRepeats: 11,
					error: {
						name: 'GhError',
						code: null,
						kind: 'auth-required',
						message: 'not logged in to github.com',
						detail: 'caused by Error: gh exited with code 4\n  run gh auth login',
						stack: null,
					},
				}),
			),
		);

		const { stdout } = await execFileAsync(process.execPath, [...NODE_FLAGS, CLI, '--dir', root]);

		expect(stdout.trimEnd().split('\n')).toEqual([
			'2026-09-23T08:00:00.000Z  main     warn   ipc-command pull-requests.status (12ms)  GhError [auth-required]: not logged in to github.com  (+11 identical not logged before this)  workstream=ws-1',
			'    caused by Error: gh exited with code 4',
			'      run gh auth login',
		]);
		expect(readDiagnostics(root)[0]).toMatchObject({
			detail: 'caused by Error: gh exited with code 4\n  run gh auth login',
			suppressedRepeats: 11,
		});
	});

	it('keeps info out of the warn view, and adds toasts back only when asked', async () => {
		writeFileSync(
			currentLogPath(directory, 'main'),
			ndjson(
				mainRecord('2026-09-23T08:00:00.000Z', {
					level: 'info',
					source: 'console',
					message: 'agent: reaped 0 orphaned run(s) on startup',
					command: null,
					workstreamId: null,
					durationMs: null,
					error: null,
				}),
			),
		);
		writeFileSync(
			currentLogPath(directory, 'renderer-errors'),
			ndjson({
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:01.000Z',
				level: 'info',
				source: 'toast',
				toastLevel: 'info',
				route: '/',
				workstreamId: 'ws-3',
				message: 'info toast, text not kept',
			}),
		);
		const run = async (...flags: string[]): Promise<string[]> =>
			(await execFileAsync(process.execPath, [...NODE_FLAGS, CLI, '--dir', root, ...flags])).stdout
				.split('\n')
				.filter((line) => line.length > 0);

		expect(await run('--level', 'warn')).toEqual([]);
		expect(await run('--level', 'warn', '--with-toasts')).toEqual([
			'2026-09-23T08:00:01.000Z  renderer info   toast  info toast, text not kept  workstream=ws-3',
		]);
	});

	it('narrows by --since and --level, and prints JSON lines on request', async () => {
		seedLogs();

		const { stdout } = await execFileAsync(process.execPath, [
			...NODE_FLAGS,
			CLI,
			'--dir',
			root,
			'--since',
			'2026-09-23T08:00:01.500Z',
			'--level',
			'warn',
			'--json',
		]);

		expect(
			stdout
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line).occurredAt),
		).toEqual(['2026-09-23T08:00:02.000Z', '2026-09-23T08:00:03.500Z', '2026-09-23T08:00:04.000Z']);
	});

	it('follows the logs and prints entries written after it started', async () => {
		seedLogs();
		const child = spawn(process.execPath, [
			...NODE_FLAGS,
			CLI,
			'--dir',
			root,
			'--follow',
			'--since',
			'1m',
		]);
		let output = '';
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString('utf8');
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 700));
			appendFileSync(
				currentLogPath(directory, 'main'),
				ndjson(mainRecord(new Date().toISOString(), { message: 'written while following' })),
			);
			await expect.poll(() => output, { timeout: 5_000 }).toContain('written while following');
		} finally {
			child.kill();
		}
	});

	it('refuses an unknown level with the usage', async () => {
		await expect(
			execFileAsync(process.execPath, [...NODE_FLAGS, CLI, '--dir', root, '--level', 'loud']),
		).rejects.toMatchObject({
			code: 2,
			stderr: expect.stringContaining('--level must be info, warn or error, got "loud"'),
		});
	});
});
