import { describe, expect, it } from 'vitest';
import { parseDockerStats } from './docker-usage';
import { measureProcessTree, parseProcessTable, parseWindowsProcessTable } from './process-tree';

const PS_OUTPUT = [
	'  100     1 204800  12.0 /Applications/malini.app/Contents/MacOS/malini',
	'  101   100 102400   4.0 /Applications/malini.app/Contents/Frameworks/malini Helper (GPU).app/Contents/MacOS/malini Helper (GPU)',
	'  102   100 307200   8.0 /Applications/malini.app/Contents/Frameworks/malini Helper (Renderer).app/Contents/MacOS/malini Helper (Renderer)',
	'  103   100 153600   2.0 /Applications/malini.app/Contents/Frameworks/malini Helper (Renderer).app/Contents/MacOS/malini Helper (Renderer)',
	'  110   100  51200   0.5 /Applications/malini.app/Contents/MacOS/malini',
	'  120   110 409600  20.0 /Users/me/.local/bin/claude',
	'  130   120   2048   0.0 /bin/zsh',
	'  131   130 512000  40.0 node',
	'  140   100   1024   0.0 /bin/ps',
	'  141   100   1024   0.0 (ps)',
	'  142   100   1024   0.0 /usr/sbin/lsof',
	'  200     1 999999  99.0 /Applications/Safari.app/Contents/MacOS/Safari',
	'',
].join('\n');

const MIB = 1_024 * 1_024;

describe('measureProcessTree', () => {
	it('splits malini, its browser tabs, its agents and the tools agents started, and skips its own ps and lsof, exiting ones too', () => {
		const tree = measureProcessTree(
			parseProcessTable(PS_OUTPUT),
			{ app: 100, browserTabs: new Set([103]), agentHost: 110 },
			4,
		);

		expect(tree.processes).toBe(8);
		expect(tree.usage).toEqual([
			{ kind: 'malini', memoryBytes: 600 * MIB, cpuPercent: 6, processes: 3 },
			{ kind: 'browser', memoryBytes: 150 * MIB, cpuPercent: 0.5, processes: 1 },
			{ kind: 'agents', memoryBytes: 450 * MIB, cpuPercent: 5.125, processes: 2 },
			{ kind: 'tools', memoryBytes: 502 * MIB, cpuPercent: 10, processes: 2 },
		]);
	});

	it('counts the agent bridge as malini until it is known, and nothing when malini is gone', () => {
		const rows = parseProcessTable(PS_OUTPUT);

		const withoutBridge = measureProcessTree(
			rows,
			{ app: 100, browserTabs: new Set(), agentHost: null },
			4,
		);
		expect(withoutBridge.usage.map((usage) => usage.kind)).toEqual(['malini']);
		expect(withoutBridge.processes).toBe(8);

		expect(
			measureProcessTree(rows, { app: 999, browserTabs: new Set(), agentHost: null }, 4),
		).toEqual({
			processes: 0,
			usage: [],
			units: [],
		});
	});
});

describe('parseWindowsProcessTable', () => {
	it('reads working sets in bytes and CPU as the share of one core since the last reading', () => {
		const first = parseWindowsProcessTable(
			['100 8 104857600 50000000 Malini.exe', '120 100 52428800 10000000 node.exe', ''].join(
				'\r\n',
			),
			1_000,
			null,
		);
		expect(first.rows).toEqual([
			{ pid: 100, ppid: 8, memoryBytes: 100 * MIB, cpuPercent: 0, command: 'Malini.exe' },
			{ pid: 120, ppid: 100, memoryBytes: 50 * MIB, cpuPercent: 0, command: 'node.exe' },
		]);

		const second = parseWindowsProcessTable(
			[
				'100 8 104857600 75000000 Malini.exe',
				'120 100 52428800 5000000 node.exe',
				'130 100 1048576 10000000 git.exe',
			].join('\r\n'),
			6_000,
			first.cpuTimes,
		);
		expect(second.rows.map(({ pid, cpuPercent }) => [pid, cpuPercent])).toEqual([
			[100, 50],
			[120, 0],
			[130, 20],
		]);
	});
});

describe('parseDockerStats', () => {
	it('adds up the containers and turns Docker units into bytes', () => {
		expect(
			parseDockerStats('web\t0.15%\t45MiB / 7.66GiB\ndb\t2.00%\t1.5GiB / 7.66GiB\n', 2),
		).toEqual({
			usage: {
				kind: 'docker',
				memoryBytes: 45 * MIB + 1.5 * 1_024 * MIB,
				cpuPercent: 1.075,
				processes: 2,
			},
			containers: [
				{ label: 'web', workstream: null, memoryBytes: 45 * MIB },
				{ label: 'db', workstream: null, memoryBytes: 1.5 * 1_024 * MIB },
			],
		});
		expect(parseDockerStats('', 2)).toBeNull();
	});
});
