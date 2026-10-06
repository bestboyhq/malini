import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { GhError, GitError } from '../errors';
import { CommandRegistry } from '../ipc/registry';
import {
	captureMainProcess,
	nodeProcessHooks,
	type CapturableConsole,
	type MainProcessHooks,
} from './capture';
import { currentLogPath, diagnosticsDirectory, rotatedLogPath } from './diagnostics-files';
import {
	MAX_RECORDS_PER_WINDOW,
	MainDiagnosticsLog,
	RECORD_WINDOW_MS,
	REPEAT_WINDOW_MS,
	type DiagnosticsRuntime,
} from './main-diagnostics';

const RUNTIME: DiagnosticsRuntime = {
	productName: 'malini',
	bundleIdentifier: 'app.malini.desktop.dev',
	version: '0.1.0',
	pid: 4242,
};

let root: string;
let clock: number;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'malini-main-diagnostics-'));
	clock = Date.parse('2026-09-23T08:00:00.000Z');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function log(options: { appDataRoot?: string; report?: (message: string) => void } = {}) {
	return new MainDiagnosticsLog({
		appDataRoot: options.appDataRoot ?? root,
		runtime: RUNTIME,
		now: () => new Date(clock),
		home: '/Users/alice',
		...(options.report ? { reportWriteFailure: options.report } : {}),
	});
}

function records(): Array<Record<string, unknown>> {
	const path = currentLogPath(diagnosticsDirectory(root), 'main');
	if (!existsSync(path)) return [];
	return readFileSync(path, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
}

describe('the main-process diagnostics log', () => {
	it('records a failed command with its error, duration and workstream id, and nothing else from the args', async () => {
		const diagnostics = log();
		const registry = new CommandRegistry();
		registry.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		registry.define('repositories.archive-workstream', () => {
			throw GitError.io("EACCES: permission denied, rename '/Users/alice/ws'", 'EACCES');
		});

		await registry.invoke({
			command: 'repositories.archive-workstream',
			args: {
				workstreamId: 'ws-1',
				prompt: 'please refactor the billing module',
				token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
			},
		});

		const [record] = records();
		expect(record).toMatchObject({
			schemaVersion: 1,
			occurredAt: '2026-09-23T08:00:00.000Z',
			level: 'error',
			source: 'ipc-command',
			message: "io error: EACCES: permission denied, rename '[home]/ws'",
			command: 'repositories.archive-workstream',
			workstreamId: 'ws-1',
			durationMs: expect.any(Number),
			error: {
				name: 'GitError',
				code: 'EACCES',
				kind: 'io',
				message: "io error: EACCES: permission denied, rename '[home]/ws'",
				stack: expect.stringContaining('GitError: io error'),
			},
			runtime: RUNTIME,
		});
		const written = readFileSync(currentLogPath(diagnosticsDirectory(root), 'main'), 'utf8');
		expect(written).not.toContain('billing module');
		expect(written).not.toContain('ghp_');
		expect(written).not.toContain('/Users/alice');
	});

	it('keeps the technical cause of a human failure message, and redacts it too', async () => {
		const diagnostics = log();
		const registry = new CommandRegistry();
		registry.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		registry.define('repositories.delete-workstream', () => {
			const git = GitError.commandFailed({
				args: ['-C', '/Users/alice/ws', 'add', '-A', '--', '.'],
				exitCode: 128,
				signal: null,
				output: "fatal: Unable to create '/Users/alice/ws/.git/index.lock': File exists.\n",
			});
			throw new Error('Saving its local work failed, so nothing was removed', { cause: git });
		});

		await registry.invoke({
			command: 'repositories.delete-workstream',
			args: { workstreamId: 'ws-2' },
		});

		const [record] = records();
		expect(record).toMatchObject({
			message: 'Saving its local work failed, so nothing was removed',
			workstreamId: 'ws-2',
			error: {
				message: 'Saving its local work failed, so nothing was removed',
				detail: [
					'caused by GitError: Git is busy in this workstream (index.lock). Try again in a moment.',
					'caused by Error: git -C [home]/ws add -A -- . exited with code 128',
					"  fatal: Unable to create '[home]/ws/.git/index.lock': File exists.",
				].join('\n'),
				stack: expect.stringMatching(
					/caused by: Error: git -C \[home\]\/ws add -A -- \. exited with code 128\nfatal: Unable to create/u,
				),
			},
		});
		expect(readFileSync(currentLogPath(diagnosticsDirectory(root), 'main'), 'utf8')).not.toContain(
			'/Users/alice',
		);
	});

	it('logs a repeating command failure once per window, then says how many it left out', async () => {
		const diagnostics = log();
		const registry = new CommandRegistry();
		registry.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		registry.define('pull-requests.status', () => {
			throw GhError.fromStderr('gh: not logged in to github.com. Run gh auth login', 4);
		});
		registry.define('pull-requests.merge', () => {
			throw GhError.fromStderr('merge conflict', 1);
		});
		const poll = (workstreamId: string): Promise<unknown> =>
			registry.invoke({
				command: 'pull-requests.status',
				args: { repoId: 'r-1', head: `malini/${workstreamId}`, workstreamId },
			});

		await poll('ws-1');
		await poll('ws-2');
		await registry.invoke({ command: 'pull-requests.merge', args: { repoId: 'r-1' } });
		clock += REPEAT_WINDOW_MS - 1;
		await poll('ws-3');
		clock += 1;
		await poll('ws-4');

		expect(
			records().map((record) => [
				record.command,
				record.level,
				record.workstreamId,
				record.suppressedRepeats,
			]),
		).toEqual([
			['pull-requests.status', 'warn', 'ws-1', 0],
			['pull-requests.merge', 'error', null, 0],
			['pull-requests.status', 'warn', 'ws-4', 2],
		]);
	});

	it('logs a prompt the runtime turned away while a run closes as a warning, the renderer retries it', async () => {
		const diagnostics = log();
		const registry = new CommandRegistry();
		registry.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
		const refusal = (kind: string, message: string): Error =>
			Object.assign(new Error(message), { name: 'LifecycleError', kind });
		registry.define('chat.send-prompt', (args) => {
			const kind = typeof args === 'object' && args !== null ? Reflect.get(args, 'kind') : '';
			if (kind === 'already_running') {
				throw refusal(kind, 'work stream `ws-1` already has an active run');
			}
			throw refusal('db', 'database is locked');
		});

		await registry.invoke({ command: 'chat.send-prompt', args: { kind: 'already_running' } });
		await registry.invoke({ command: 'chat.send-prompt', args: { kind: 'db' } });

		expect(records().map((record) => [record.message, record.level])).toEqual([
			['work stream `ws-1` already has an active run', 'warn'],
			['database is locked', 'error'],
		]);
	});

	it('gives routine info lines their own budget so they never crowd out a failure', () => {
		const diagnostics = log();
		for (let index = 0; index < MAX_RECORDS_PER_WINDOW + 20; index += 1) {
			diagnostics.record({ level: 'info', source: 'console', message: `banner ${index}` });
		}
		diagnostics.record({ level: 'error', source: 'console', message: 'the real failure' });

		expect(records().at(-1)).toMatchObject({ level: 'error', message: 'the real failure' });
	});

	it('keeps at most a window of records and then says how many it dropped', () => {
		const diagnostics = log();
		for (let index = 0; index < MAX_RECORDS_PER_WINDOW + 5; index += 1) {
			diagnostics.record({ level: 'warn', source: 'console', message: `warning ${index}` });
		}
		clock += RECORD_WINDOW_MS;
		diagnostics.record({ level: 'error', source: 'console', message: 'after the storm' });

		const written = records();
		expect(written).toHaveLength(MAX_RECORDS_PER_WINDOW + 2);
		expect(written.at(-2)).toMatchObject({
			level: 'warn',
			source: 'diagnostics',
			message: `5 main-process diagnostics were dropped: more than ${MAX_RECORDS_PER_WINDOW} in 10s`,
		});
		expect(written.at(-1)).toMatchObject({ message: 'after the storm' });
	});

	it('rotates into main.<n>.ndjson instead of growing without bound', () => {
		const diagnostics = log();
		const message = 'x'.repeat(2_000);
		for (let index = 0; index < 400; index += 1) {
			clock += RECORD_WINDOW_MS;
			diagnostics.record({ level: 'warn', source: 'console', message });
		}

		expect(existsSync(rotatedLogPath(diagnosticsDirectory(root), 'main', 1))).toBe(true);
		expect(
			readFileSync(currentLogPath(diagnosticsDirectory(root), 'main')).byteLength,
		).toBeLessThanOrEqual(256 * 1024);
	});

	it('never throws when the log cannot be written, and reports that once', () => {
		const blocked = join(root, 'not-a-directory');
		writeFileSync(blocked, 'file');
		const reports: string[] = [];
		const diagnostics = log({ appDataRoot: blocked, report: (message) => reports.push(message) });

		expect(() => {
			diagnostics.record({ level: 'error', source: 'console', message: 'one' });
			diagnostics.record({ level: 'error', source: 'console', message: 'two' });
		}).not.toThrow();
		expect(reports).toHaveLength(1);
		expect(reports[0]).toContain('the main-process diagnostics log is not writable');
	});
});

describe('capturing the main process', () => {
	type Listener = (value: unknown) => void;

	function hooksFor(output: CapturableConsole): MainProcessHooks & {
		rejection: Listener[];
		exception: Listener[];
		warning: Array<(warning: Error) => void>;
	} {
		const rejection: Listener[] = [];
		const exception: Listener[] = [];
		const warning: Array<(warning: Error) => void> = [];
		return {
			console: output,
			rejection,
			exception,
			warning,
			onWarning(listener) {
				warning.push(listener);
				return () => warning.splice(warning.indexOf(listener), 1);
			},
			onUnhandledRejection(listener) {
				rejection.push(listener);
				return () => rejection.splice(rejection.indexOf(listener), 1);
			},
			onUncaughtException(listener) {
				exception.push(listener);
				return () => exception.splice(exception.indexOf(listener), 1);
			},
		};
	}

	function recordingConsole(): CapturableConsole & { printed: unknown[][] } {
		const printed: unknown[][] = [];
		return {
			printed,
			info: (...values: unknown[]) => printed.push(['info', ...values]),
			warn: (...values: unknown[]) => printed.push(['warn', ...values]),
			error: (...values: unknown[]) => printed.push(['error', ...values]),
		};
	}

	it('records every console warning and error while still printing them', () => {
		const output = recordingConsole();
		const stop = captureMainProcess(log(), hooksFor(output));

		output.warn('malini: the base sync was skipped for', { workstreamId: 'ws-3' });
		output.error('malini: shutdown failed', new Error('docker is not running'));
		stop();
		output.warn('after stop');

		expect(output.printed.map((line) => line[0])).toEqual(['warn', 'error', 'warn']);
		expect(records()).toEqual([
			expect.objectContaining({
				level: 'warn',
				source: 'console',
				message: "malini: the base sync was skipped for { workstreamId: 'ws-3' }",
				workstreamId: 'ws-3',
				error: null,
			}),
			expect.objectContaining({
				level: 'error',
				source: 'console',
				message: expect.stringContaining('malini: shutdown failed Error: docker is not running'),
				error: expect.objectContaining({ name: 'Error', message: 'docker is not running' }),
			}),
		]);
	});

	it('records unhandled rejections and uncaught exceptions with their stacks', () => {
		const output = recordingConsole();
		const hooks = hooksFor(output);
		captureMainProcess(log(), hooks);

		hooks.rejection.forEach((listener) => listener(new TypeError('lease is undefined')));
		hooks.exception.forEach((listener) => listener(new RangeError('bad offset')));
		hooks.rejection.forEach((listener) => listener(undefined));

		expect(records()).toEqual([
			expect.objectContaining({
				source: 'unhandled-rejection',
				level: 'error',
				message: 'lease is undefined',
				error: expect.objectContaining({ name: 'TypeError', stack: expect.any(String) }),
			}),
			expect.objectContaining({
				source: 'uncaught-exception',
				message: 'bad offset',
				error: expect.objectContaining({ name: 'RangeError' }),
			}),
			expect.objectContaining({
				source: 'unhandled-rejection',
				message: 'no reason given, threw undefined',
			}),
		]);
		expect(output.printed.filter((line) => line[0] === 'error')).toHaveLength(3);
	});

	it('handles uncaught exceptions itself, so Electron never stalls the main process on its error box', () => {
		const target = new EventEmitter();
		const thrown = new TypeError('Object has been destroyed');
		const seen: unknown[] = [];
		const stop = nodeProcessHooks(target, recordingConsole()).onUncaughtException((error) =>
			seen.push(error),
		);

		expect(target.listenerCount('uncaughtException')).toBe(1);
		target.emit('uncaughtException', thrown, 'uncaughtException');
		stop();

		expect(seen).toEqual([thrown]);
		expect(target.listenerCount('uncaughtException')).toBe(0);
	});

	it('records a process warning once, as a warning, and not the echo node prints for it', () => {
		const output = recordingConsole();
		const hooks = hooksFor(output);
		captureMainProcess(log(), hooks);
		const warning = Object.assign(new Error('Buffer() is deprecated'), {
			name: 'DeprecationWarning',
			code: 'DEP0005',
		});

		hooks.warning.forEach((listener) => listener(warning));
		output.error(`(node:${process.pid}) [DEP0005] DeprecationWarning: Buffer() is deprecated`);

		expect(records()).toEqual([
			expect.objectContaining({
				level: 'warn',
				source: 'process-warning',
				message: 'DeprecationWarning: Buffer() is deprecated',
				error: expect.objectContaining({ name: 'DeprecationWarning', code: 'DEP0005' }),
			}),
		]);
		expect(output.printed).toHaveLength(1);
	});

	it('records console.info at info level', () => {
		const output = recordingConsole();
		captureMainProcess(log(), hooksFor(output));

		output.info('agent: reaped 0 orphaned run(s) on startup');

		expect(records()).toEqual([expect.objectContaining({ level: 'info', source: 'console' })]);
	});

	it('does not loop when reporting a broken log goes through the captured console', () => {
		const blocked = join(root, 'not-a-directory');
		writeFileSync(blocked, 'file');
		const output = recordingConsole();
		const diagnostics = log({ appDataRoot: blocked, report: (message) => output.error(message) });
		captureMainProcess(diagnostics, hooksFor(output));

		output.error('malini: first failure');
		output.error('malini: second failure');

		expect(output.printed.map((line) => String(line[1]))).toEqual([
			'malini: first failure',
			expect.stringContaining('the main-process diagnostics log is not writable'),
			'malini: second failure',
		]);
	});
});
