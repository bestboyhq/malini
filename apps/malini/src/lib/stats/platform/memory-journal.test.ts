import { describe, expect, it } from 'vitest';
import { heaviestOutside, journalProcess, launchersOf, parseFootprints } from './memory-journal';
import { parseProcessTable } from './process-tree';

const MIB = 1_024 * 1_024;
const GIB = 1_024 * MIB;

const TOP_OUTPUT = [
	'Processes: 843 total, 4 running, 839 sleeping, 4920 threads',
	'2026/10/18 19:54:30',
	'PhysMem: 29G used (4506M wired, 747M compressor), 34G unused.',
	'',
	'PID    MEM',
	'406    1264M',
	'82127  1183M+',
	'90     644K',
	'91     2G',
	'',
].join('\n');

const PS_OUTPUT = [
	'    1     0  1024   0.0 /sbin/launchd',
	'   10     1  2048   0.0 /Applications/WezTerm.app/Contents/MacOS/wezterm-gui',
	'   20    10  4096   0.0 node',
	'   30    20  8192   0.0 node',
	'  100    30 10240   1.0 /Applications/malini.app/Contents/MacOS/malini',
	'  110   100 20480   1.0 /Applications/malini.app/Contents/MacOS/malini',
	'  120   110 40960   1.0 /Users/me/.local/bin/claude',
	'  200     1 99999   0.0 /Users/me/.local/bin/claude',
	'  300     1 51200   0.0 /Applications/Spotify.app/Contents/MacOS/Spotify',
	'',
].join('\n');

describe('parseFootprints', () => {
	it("reads each process's footprint and the machine's physical memory from top", () => {
		const { byProcess, physical } = parseFootprints(TOP_OUTPUT);

		expect([...byProcess]).toEqual([
			[406, 1_264 * MIB],
			[82127, 1_183 * MIB],
			[90, 644 * 1_024],
			[91, 2 * GIB],
		]);
		expect(physical).toEqual({
			usedBytes: 29 * GIB,
			wiredBytes: 4_506 * MIB,
			compressorBytes: 747 * MIB,
			unusedBytes: 34 * GIB,
		});
		expect(parseFootprints('top: unknown option').physical).toBeNull();
	});
});

describe('the processes around malini', () => {
	const rows = parseProcessTable(PS_OUTPUT);
	const launchers = launchersOf(rows, 100);

	it('walks the launcher chain up to launchd', () => {
		expect(launchers.map((row) => row.pid)).toEqual([30, 20, 10]);
	});

	it("lists the heaviest processes outside malini's tree, like an agent orphaned by a restart", () => {
		expect(heaviestOutside(rows, 100, launchers, 2).map((row) => row.pid)).toEqual([200, 300]);
	});

	it('redacts secrets and the home folder from a process label', () => {
		const row = { pid: 5, ppid: 1, memoryBytes: MIB, cpuPercent: 0, command: '/usr/bin/curl' };
		const commandLines = new Map([
			[5, `/usr/bin/curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop" /Users/me/x`],
		]);

		const { label } = journalProcess(row, commandLines);

		expect(label).toMatch(/^curl /u);
		expect(label).not.toContain('sk-ant-api03-abcdefghijklmnop');
		expect(label).not.toContain('/Users/me');
	});
});
