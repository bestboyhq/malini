import { describe, expect, it } from 'vitest';
import { measureProcessTree, parseProcessTable } from './process-tree';
import {
	describeBreakdown,
	parseCommandLines,
	parseWorkingDirectories,
	unitsByKind,
} from './resource-breakdown';

const MIB = 1_024 * 1_024;
const APP = '/Applications/malini.app/Contents/MacOS/malini';
const HELPER =
	'/Applications/malini.app/Contents/Frameworks/malini Helper.app/Contents/MacOS/malini Helper';
const RENDERER =
	'/Applications/malini.app/Contents/Frameworks/malini Helper (Renderer).app/Contents/MacOS/malini Helper (Renderer)';
const WORKSTREAMS = '/Users/me/Library/Application Support/malini/workstreams';

const PS_OUTPUT = [
	`  100     1 204800  12.0 ${APP}`,
	`  101   100 102400   4.0 ${HELPER}`,
	`  102   100  51200   1.0 ${HELPER}`,
	`  103   100 307200   8.0 ${RENDERER}`,
	`  104   100 153600   2.0 ${RENDERER}`,
	`  110   100  51200   0.5 ${APP}`,
	'  120   110 409600  20.0 /Users/me/.local/bin/claude',
	'  121   120 204800   1.0 /Users/me/.local/bin/codebase-memory-mcp',
	'  130   120   2048   0.0 /bin/zsh',
	'  131   130   4096   0.0 bun',
	'  132   131 2097152 40.0 bun',
	'  140   110 307200  10.0 /Users/me/.local/bin/claude',
	'  141   140 102400   1.0 /Users/me/.local/bin/codebase-memory-mcp',
	'',
].join('\n');

const COMMAND_LINES = [
	`  101 ${HELPER} --type=gpu-process --gpu-preferences=AAAA`,
	`  102 ${HELPER} --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en`,
	`  103 ${RENDERER} --type=renderer --app-path=/Applications/malini.app`,
	'  121 /Users/me/.local/bin/codebase-memory-mcp',
	'  132 bun run --cwd tools/playtest start --port 5231',
	'  141 /Users/me/.local/bin/codebase-memory-mcp',
	'',
].join('\n');

const LSOF_OUTPUT = [
	'p120',
	'fcwd',
	`n${WORKSTREAMS}/ws-1`,
	'p140',
	'fcwd',
	`n${WORKSTREAMS}/ws-2/packages/web`,
	'',
].join('\n');

describe('describeBreakdown', () => {
	it('names what each unit is and which workstream an agent and its programs work in', () => {
		const roots = { app: 100, browserTabs: new Set([104]), agentHost: 110 };
		const tree = measureProcessTree(parseProcessTable(PS_OUTPUT), roots, 4);

		const breakdown = describeBreakdown(
			unitsByKind(tree.units),
			{
				roots,
				commandLines: parseCommandLines(COMMAND_LINES),
				tabTitles: new Map([[104, 'Served page']]),
				workingDirectories: parseWorkingDirectories(LSOF_OUTPUT),
				workstreams: [
					{ path: `${WORKSTREAMS}/ws-1`, name: 'Playtest HUD' },
					{ path: `${WORKSTREAMS}/ws-2`, name: 'Stats breakdown' },
				],
			},
			[
				{ label: 'web', workstream: null, memoryBytes: 45 * MIB },
				{ label: 'db', workstream: null, memoryBytes: 90 * MIB },
			],
		);

		expect(breakdown).toEqual([
			{
				kind: 'tools',
				items: [
					{
						label: 'bun run --cwd tools/playtest start --port 5231',
						workstream: 'Playtest HUD',
						memoryBytes: 2054 * MIB,
					},
					{ label: 'codebase-memory-mcp', workstream: 'Playtest HUD', memoryBytes: 200 * MIB },
					{ label: 'codebase-memory-mcp', workstream: 'Stats breakdown', memoryBytes: 100 * MIB },
				],
				unlisted: 0,
				unlistedMemoryBytes: 0,
			},
			{
				kind: 'agents',
				items: [
					{ label: 'Claude Code', workstream: 'Playtest HUD', memoryBytes: 400 * MIB },
					{ label: 'Claude Code', workstream: 'Stats breakdown', memoryBytes: 300 * MIB },
					{ label: 'Agent bridge', workstream: null, memoryBytes: 50 * MIB },
				],
				unlisted: 0,
				unlistedMemoryBytes: 0,
			},
			{
				kind: 'malini',
				items: [
					{ label: 'Window', workstream: null, memoryBytes: 300 * MIB },
					{ label: 'Main process', workstream: null, memoryBytes: 200 * MIB },
					{ label: 'Graphics', workstream: null, memoryBytes: 100 * MIB },
					{ label: 'Network service', workstream: null, memoryBytes: 50 * MIB },
				],
				unlisted: 0,
				unlistedMemoryBytes: 0,
			},
			{
				kind: 'browser',
				items: [{ label: 'Served page', workstream: null, memoryBytes: 150 * MIB }],
				unlisted: 0,
				unlistedMemoryBytes: 0,
			},
			{
				kind: 'docker',
				items: [
					{ label: 'db', workstream: null, memoryBytes: 90 * MIB },
					{ label: 'web', workstream: null, memoryBytes: 45 * MIB },
				],
				unlisted: 0,
				unlistedMemoryBytes: 0,
			},
		]);
	});

	it('lists the five heaviest units of a kind and sums up the rest', () => {
		const roots = { app: 1, browserTabs: new Set<number>(), agentHost: null };
		const helpers = Array.from(
			{ length: 7 },
			(_, index) => `${10 + index} 1 ${1_024 * (index + 1)} 0.0 git`,
		);
		const tree = measureProcessTree(
			parseProcessTable([`1 0 1024 0.0 ${APP}`, ...helpers].join('\n')),
			roots,
			1,
		);

		const [malini] = describeBreakdown(
			unitsByKind(tree.units),
			{
				roots,
				commandLines: new Map(),
				tabTitles: new Map(),
				workingDirectories: new Map(),
				workstreams: [],
			},
			[],
		);

		expect(malini?.items.map((item) => item.memoryBytes / MIB)).toEqual([7, 6, 5, 4, 3]);
		expect(malini?.items[0]?.label).toBe('git');
		expect(malini?.unlisted).toBe(3);
		expect(malini?.unlistedMemoryBytes).toBe(4 * MIB);
	});
});
