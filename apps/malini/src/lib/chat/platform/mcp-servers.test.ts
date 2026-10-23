import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_MCP_SERVERS_LISTED_CHANNEL } from '$contract/events';
import type { McpServerReport } from '$contract/mcp-servers';
import { openMigratedDatabase } from '$main/db/open';
import { recordingEventBus } from './agent/test-support';
import {
	McpServerListings,
	shownMcpServers,
	turnedOffMcpServers,
	withMcpServerSwitched,
} from './mcp-servers';

describe('MCP server switches', () => {
	it('turns a server off through deniedMcpServers and back on, keeping every other entry', () => {
		const settings = {
			model: 'opus',
			deniedMcpServers: [{ serverUrl: 'https://*.example.com/*' }, { serverName: 'linear' }],
		};

		const off = withMcpServerSwitched(settings, 'claude.ai Gmail', false);
		expect(off).toEqual({
			model: 'opus',
			deniedMcpServers: [
				{ serverUrl: 'https://*.example.com/*' },
				{ serverName: 'linear' },
				{ serverName: 'claude.ai Gmail' },
			],
		});
		expect(turnedOffMcpServers(off)).toEqual(['linear', 'claude.ai Gmail']);

		const on = withMcpServerSwitched(
			withMcpServerSwitched(off, 'linear', true),
			'claude.ai Gmail',
			true,
		);
		expect(on).toEqual({
			model: 'opus',
			deniedMcpServers: [{ serverUrl: 'https://*.example.com/*' }],
		});
		expect(withMcpServerSwitched({ deniedMcpServers: [{ serverName: 'x' }] }, 'x', true)).toEqual(
			{},
		);
	});
});

describe('shownMcpServers', () => {
	const linear: McpServerReport = { name: 'linear', status: 'connected', source: 'user' };
	const sentry: McpServerReport = { name: 'sentry', status: 'failed', source: 'project' };

	it('keeps what it knew while a Claude Code connects and adds what is new', () => {
		expect(
			shownMcpServers(
				[linear, sentry],
				[
					{ name: 'linear', status: 'pending', source: 'user' },
					{ name: 'gmail', status: 'pending', source: 'claudeai' },
				],
				false,
				[],
			),
		).toEqual([linear, sentry, { name: 'gmail', status: 'pending', source: 'claudeai' }]);
	});

	it('takes a settled listing as it is, keeping a turned-off server where it came from', () => {
		expect(
			shownMcpServers([linear, sentry], [{ ...sentry, status: 'connected' }], true, ['linear']),
		).toEqual([
			{ ...sentry, status: 'connected' },
			{ name: 'linear', status: 'disabled', source: 'user' },
		]);
	});

	it('shows a server being turned back on as connecting until its Claude Code lists it', () => {
		expect(shownMcpServers([linear, sentry], [sentry], true, [], new Set(['linear']))).toEqual([
			sentry,
			{ name: 'linear', status: 'pending', source: 'user' },
		]);
		expect(shownMcpServers([linear, sentry], [sentry], true, [])).toEqual([sentry]);
	});
});

describe('McpServerListings', () => {
	const root = mkdtempSync(join(tmpdir(), 'malini-mcp-'));
	const settingsFile = join(root, 'settings.json');
	const db = openMigratedDatabase(':memory:');
	const switches: string[] = [];
	const watched: string[] = [];
	let switchedFolders: string[] = [];
	const supervisor = {
		watchMcpServers: async (cwd: string) => {
			watched.push(cwd);
		},
		switchMcpServer: async (serverName: string, on: boolean, folders: readonly string[]) => {
			switches.push(`${serverName} ${on ? 'on' : 'off'} [${folders.join(', ')}]`);
			return switchedFolders;
		},
		authorizeMcpServer: async () => null,
		reconnectMcpServer: async () => undefined,
		cancelMcpAuthorization: async () => undefined,
	};
	const events = recordingEventBus();
	const listings = new McpServerListings({
		db,
		events,
		runtime: { ensureReady: async () => supervisor, ensureSessionReady: async () => supervisor },
		claudeSettings: () => settingsFile,
		resolveWorkstreamCheckout: async (workstreamId) => `/work/${workstreamId}`,
		log: () => undefined,
	});

	afterEach(() => {
		switches.length = 0;
		watched.length = 0;
	});

	it('answers from what it saw last time while the folder connects again', async () => {
		writeFileSync(settingsFile, '{}');
		await expect(listings.watch('one')).resolves.toEqual({
			servers: [],
			settled: false,
			turnedOff: [],
		});
		listings.received({
			cwd: '/work/one',
			servers: [
				{ name: 'linear', status: 'connected', source: 'user' },
				{ name: 'repo-db', status: 'connected', source: 'project' },
			],
			settled: true,
		});

		await expect(listings.watch('two')).resolves.toEqual({
			servers: [{ name: 'linear', status: 'connected', source: 'user' }],
			settled: false,
			turnedOff: [],
		});
		expect(watched).toEqual(['/work/one', '/work/two']);
		expect(
			events.frames.filter(({ channel }) => channel === CHAT_MCP_SERVERS_LISTED_CHANNEL),
		).toEqual([
			{
				channel: CHAT_MCP_SERVERS_LISTED_CHANNEL,
				payload: {
					workstreamId: 'one',
					servers: [
						{ name: 'linear', status: 'connected', source: 'user' },
						{ name: 'repo-db', status: 'connected', source: 'project' },
					],
					settled: true,
				},
			},
		]);
	});

	it('remembers where a live switch turned a server off, to turn it back on there', async () => {
		writeFileSync(settingsFile, '{}');
		switchedFolders = ['/work/one'];
		await expect(listings.switchServer('linear', false)).resolves.toEqual(['linear']);
		switchedFolders = ['/work/one'];
		await expect(listings.switchServer('linear', true)).resolves.toEqual([]);
		switchedFolders = [];
		await listings.switchServer('linear', true);

		expect(switches).toEqual(['linear off []', 'linear on [/work/one]', 'linear on []']);
		expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({});
	});
});
