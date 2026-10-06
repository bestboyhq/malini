import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMainProcess, type CapturableConsole } from './capture';
import { readDiagnostics } from './diagnostics-files';
import { MainDiagnosticsLog } from './main-diagnostics';
import {
	bridgeStderrLevel,
	consolePlatformLog,
	platformLineLevel,
	platformLineSink,
} from './platform-log';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'malini-platform-log-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('the level of a platform log line', () => {
	it('treats a platform failure as an error unless it is known to be routine or degraded', () => {
		expect(platformLineLevel('agent: startup orphan reap failed (continuing): db locked')).toBe(
			'error',
		);
		expect(platformLineLevel('agent: bridge script is missing at /app/bridge.js')).toBe('error');
		expect(
			platformLineLevel('shutdown: 1 step(s) did not finish: could not enumerate owned containers'),
		).toBe('error');
		expect(platformLineLevel('agent-bridge protocol: unexpected frame')).toBe('error');
		expect(platformLineLevel('agent: reaped 0 orphaned run(s) on startup')).toBe('info');
		expect(platformLineLevel('agent: reaped 3 orphaned run(s) on startup')).toBe('warn');
		expect(
			platformLineLevel(
				'agent: remembered approval `a-1` bridge unavailable; showing prompt: bridge down',
			),
		).toBe('warn');
		expect(
			platformLineLevel('malini: stopped watching workstream `ws-1`: the watcher closed'),
		).toBe('warn');
	});

	it('reads bridge stderr: failures and their stack as errors, provider banners as info', () => {
		expect(bridgeStderrLevel('FATAL: Error: cannot open socket')).toBe('error');
		expect(bridgeStderrLevel('    at connect (bridge.js:1:2)', 'error')).toBe('error');
		expect(bridgeStderrLevel('dispatch error: TypeError: x is undefined')).toBe('error');
		expect(bridgeStderrLevel('[agent-provider] owned-loop=true transport=anthropic')).toBe('info');
		expect(bridgeStderrLevel('something unexpected on stderr')).toBe('warn');
	});
});

describe('the platform log sink in the running main process', () => {
	function recordingConsole(): CapturableConsole & { printed: string[] } {
		const printed: string[] = [];
		return {
			printed,
			info: (...values: unknown[]) => printed.push(`info ${values.join(' ')}`),
			warn: (...values: unknown[]) => printed.push(`warn ${values.join(' ')}`),
			error: (...values: unknown[]) => printed.push(`error ${values.join(' ')}`),
		};
	}

	it('records each line at its level, keeps printing it, and keeps info out of the warn view', () => {
		const output = recordingConsole();
		captureMainProcess(
			new MainDiagnosticsLog({
				appDataRoot: root,
				runtime: { productName: 'malini', bundleIdentifier: 'b', version: '0.1.0', pid: 1 },
				home: '',
			}),
			{
				console: output,
				onUnhandledRejection: () => () => undefined,
				onUncaughtException: () => () => undefined,
				onWarning: () => () => undefined,
			},
		);
		const log = platformLineSink(consolePlatformLog(output));

		log('agent: reaped 0 orphaned run(s) on startup');
		log('agent-bridge stderr: [agent-provider] owned-loop=true transport=anthropic');
		log('agent-bridge stderr: FATAL: Error: cannot open socket');
		log('agent-bridge stderr:     at connect (bridge.js:1:2)');
		log('agent: startup orphan reap failed (continuing): db locked');
		log('malini: watching workstream `ws-1` without its git dir: ENOENT');

		expect(output.printed.map((line) => line.split(' ')[0])).toEqual([
			'info',
			'info',
			'error',
			'error',
			'error',
			'warn',
		]);
		expect(readDiagnostics(root).map((entry) => [entry.level, entry.message])).toEqual([
			['info', 'agent: reaped 0 orphaned run(s) on startup'],
			['info', 'agent-bridge stderr: [agent-provider] owned-loop=true transport=anthropic'],
			['error', 'agent-bridge stderr: FATAL: Error: cannot open socket'],
			['error', 'agent-bridge stderr:     at connect (bridge.js:1:2)'],
			['error', 'agent: startup orphan reap failed (continuing): db locked'],
			['warn', 'malini: watching workstream `ws-1` without its git dir: ENOENT'],
		]);
		expect(readDiagnostics(root, { minimumLevel: 'warn' })).toHaveLength(4);
	});
});
