import { describe, expect, it } from 'vitest';
import { leftoverContainers, leftoverProcesses, parseProcessList } from './leftovers';
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
});

describe('leftoverContainers', () => {
	const container = (id: string, workingDir: string): DockerContainer => ({
		id,
		name: id,
		image: 'mongo:7',
		startedAt: 0,
		ports: [],
		labels: { 'com.docker.compose.project.working_dir': workingDir },
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
});
