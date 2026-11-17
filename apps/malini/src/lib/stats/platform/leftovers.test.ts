import { describe, expect, it } from 'vitest';
import type { ProcessExit, ProcessRunner } from '$main/process/runner';
import {
	leftoverContainers,
	leftoverProcesses,
	parseProcessList,
	windowsTerminalProcesses,
} from './leftovers';
import type { DockerContainer } from './running-docker';

const ROOT = '/Users/me/Library/Application Support/malini/workstreams';
const ARCHIVED = { id: 'ws-1', path: `${ROOT}/ws-1` };
const LIVE = { id: 'ws-10', path: `${ROOT}/ws-10` };

const TABLE = [
	'    1     0 ??       /sbin/launchd',
	'  100     1 ttys001  -zsh',
	'  110   100 ttys001  node /Users/me/.nvm/bin/pnpm dogfood',
	'  200   110 ??       /Users/me/dev/malini/Electron .',
	'  210   200 ??       /Users/me/dev/malini/Electron agent-bridge/cli.js --stdio',
	`  220   210 ??       /bin/zsh -c cd '${ARCHIVED.path}' && pnpm dev`,
	`  300     1 ??       ${ARCHIVED.path}/node_modules/workerd/bin/workerd serve`,
	'  310     1 ??       node /Users/me/.nvm/bin/pnpm exec vite preview --port 4173',
	`  311   310 ??       node ${ARCHIVED.path}/apps/site/node_modules/.bin/vite preview`,
	'  312   311 ??       /usr/local/bin/esbuild --service',
	`  400   100 ttys001  vim ${ARCHIVED.path}/README.md`,
	`  500     1 ??       ${LIVE.path}/node_modules/.bin/playwright test`,
	`  600     1 ??       node ${ROOT}/.trash/ws-7-1792687710921/server.js`,
].join('\n');

describe('leftoverProcesses', () => {
	const listed = parseProcessList(TABLE);

	it('stops what runs from an archived checkout and its children, never the app or a terminal', () => {
		const place = { folders: [ARCHIVED], live: [LIVE] };
		expect(leftoverProcesses(listed, place, 200).sort()).toEqual([300, 311, 312]);
	});

	it('sweeps every folder no live workstream owns, the checkout trash included', () => {
		const place = { folders: [{ id: 'workstreams', path: ROOT }], live: [LIVE] };
		expect(leftoverProcesses(listed, place, 200).sort()).toEqual([300, 311, 312, 600]);
	});

	it('keeps the processes that run the app itself, even from the swept folder', () => {
		const dogfood = parseProcessList(
			[
				`  110     1 ??       node ${ARCHIVED.path}/scripts/dogfood.mjs`,
				'  200   110 ??       Electron .',
			].join('\n'),
		);
		expect(leftoverProcesses(dogfood, { folders: [ARCHIVED], live: [] }, 200)).toEqual([]);
	});

	it('reads the Windows list and finds the checkout whatever the case and slashes of its path', () => {
		const root = 'C:\\Users\\Me\\AppData\\Roaming\\malini\\workstreams';
		const place = {
			folders: [{ id: 'ws-1', path: `${root}\\ws-1` }],
			live: [{ id: 'ws-10', path: `${root}\\ws-10` }],
		};
		const windows = parseProcessList(
			[
				'4 0 ? System',
				'200 100 ? "C:\\Program Files\\Malini\\Malini.exe"',
				'300 0 ? node.exe c:/users/me/appdata/roaming/malini/workstreams/ws-1/server.js',
				'310 300 ? C:\\Windows\\System32\\conhost.exe 0xffffffff -ForceV1',
				`500 0 ? node.exe ${root}\\ws-10\\server.js`,
			].join('\r\n'),
		);
		expect(leftoverProcesses(windows, place, 200, 'win32').sort()).toEqual([300, 310]);
	});
});

describe('windowsTerminalProcesses', () => {
	function probe(stdout: string, code = 0): ProcessRunner {
		return {
			spawn: (_file, _args, options = {}) => {
				options.onStdout?.(stdout);
				return { pid: 1, exit: Promise.resolve<ProcessExit>({ kind: 'exited', code }) };
			},
			signalProcessGroup: () => {},
			processGroupIsAlive: () => false,
			processIsAlive: () => false,
		};
	}

	it('keeps only the pids the console probe saw', async () => {
		const seen = await windowsTerminalProcesses(probe('terminals:220 400\n'), [220, 300, 400]);
		const none = await windowsTerminalProcesses(probe('terminals:\n'), [220, 300]);

		expect([...seen]).toEqual([220, 400]);
		expect([...none]).toEqual([]);
	});

	it('leaves every pid alone when the probe cannot answer', async () => {
		const seen = await windowsTerminalProcesses(probe('', 1), [220, 300]);

		expect([...seen]).toEqual([220, 300]);
	});
});

describe('leftoverContainers', () => {
	const container = (
		id: string,
		workingDir: string | null,
		bindSources: string[] = [],
	): DockerContainer => ({
		id,
		name: id,
		image: 'mongo:7',
		startedAt: 0,
		ports: [],
		labels: workingDir === null ? {} : { 'com.docker.compose.project.working_dir': workingDir },
		bindSources,
	});

	it('stops the compose projects of the swept folder, never a live one', () => {
		const containers = [
			container('archived', `${ARCHIVED.path}/apps/backend`),
			container('live', LIVE.path),
			container('elsewhere', '/Users/me/dev/shop'),
		];
		expect(leftoverContainers(containers, { folders: [ARCHIVED], live: [LIVE] })).toEqual([
			'archived',
		]);
	});

	it('stops a container that bind-mounts the swept folder, never one that mounts a live one', () => {
		const containers = [
			container('mounted', null, [`${ARCHIVED.path}/apps/backend/clickhouse-migrations`]),
			container('mounts-two-archived', null, [ARCHIVED.path, `${ROOT}/ws-7/logs`]),
			container('also-mounts-live', null, [ARCHIVED.path, `${LIVE.path}/data`]),
			container('composed-mounts-live', `${ARCHIVED.path}/infra`, [LIVE.path]),
			container('composed-elsewhere', '/Users/me/dev/shop', [ARCHIVED.path]),
			container('base-checkout', null, ['/Users/me/malini/repositories/shop/base/infra']),
			container('ancestor', null, ['/Users/me/Library/Application Support/malini']),
		];
		const swept = { folders: [{ id: 'workstreams', path: ROOT }], live: [LIVE] };

		expect(leftoverContainers(containers, { folders: [ARCHIVED], live: [LIVE] })).toEqual([
			'mounted',
			'mounts-two-archived',
			'composed-elsewhere',
		]);
		expect(leftoverContainers(containers, swept)).toEqual([
			'mounted',
			'mounts-two-archived',
			'composed-elsewhere',
		]);
	});
});
